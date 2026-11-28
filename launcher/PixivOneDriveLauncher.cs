// PixivOneDriveLauncher
//
// Native Messaging host for the "Pixiv 收藏原图 -> OneDrive" Edge extension.
// It exists so the extension can start the local helper on demand instead of
// keeping a 100+ MB process alive from boot.
//
// Protocol (Chromium native messaging, stdio):
//   stdin  : 4-byte little-endian length + UTF-8 JSON
//   stdout : 4-byte little-endian length + UTF-8 JSON
// The process handles exactly one message and exits.
//
// Only ASCII text is used in this file so the compiler needs no code page
// juggling; anything user facing is reported through launcher.log instead.

using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace PixivOneDriveLauncher
{
    internal static class Program
    {
        private const int StartTimeoutMs = 12000;
        private const int LogLimitBytes = 128 * 1024;

        private static string baseDir;
        private static string logPath;
        private static string helperPath;
        private static int port = 39391;
        private static string token = "";

        private static int Main(string[] args)
        {
            baseDir = AppDomain.CurrentDomain.BaseDirectory;
            logPath = Path.Combine(baseDir, "launcher.log");

            try
            {
                ReadConfig();

                string request = ReadNativeMessage();
                bool alreadyRunning = IsListening(port);
                bool started = false;
                int elapsedMs = 0;
                string error = "";

                if (!alreadyRunning)
                {
                    if (!StartHelper())
                    {
                        error = "helper executable not found: " + helperPath;
                    }
                    else
                    {
                        Stopwatch watch = Stopwatch.StartNew();
                        while (watch.ElapsedMilliseconds < StartTimeoutMs)
                        {
                            if (IsListening(port))
                            {
                                started = true;
                                break;
                            }
                            Thread.Sleep(120);
                        }
                        elapsedMs = (int)watch.ElapsedMilliseconds;
                        if (!started)
                        {
                            error = "helper did not open port " + port + " within " + StartTimeoutMs + "ms";
                        }
                    }
                }

                bool ready = alreadyRunning || started;

                if (request.IndexOf("\"shutdown\"", StringComparison.OrdinalIgnoreCase) >= 0 && ready)
                {
                    StopHelper();
                }

                WriteNativeMessage(BuildResponse(ready, alreadyRunning, started, elapsedMs, error));
                Log(
                    "ensure already=" + alreadyRunning +
                    " started=" + started +
                    " ready=" + ready +
                    " elapsed=" + elapsedMs + "ms" +
                    (error.Length > 0 ? " error=" + error : ""));
                return ready ? 0 : 1;
            }
            catch (Exception ex)
            {
                try
                {
                    WriteNativeMessage(BuildResponse(false, false, false, 0, ex.Message));
                }
                catch (Exception)
                {
                    // Nothing else we can do: stdout is gone.
                }
                Log("failed: " + ex);
                return 1;
            }
        }

        /* -------------------------------------------------------------- */
        /* config                                                         */
        /* -------------------------------------------------------------- */

        private static void ReadConfig()
        {
            helperPath = Path.Combine(baseDir, "PixivOneDriveHelper.exe");

            string configPath = Path.Combine(baseDir, "config.json");
            if (!File.Exists(configPath))
            {
                return;
            }

            string json = File.ReadAllText(configPath, Encoding.UTF8);

            Match portMatch = Regex.Match(json, "\"port\"\\s*:\\s*(\\d+)");
            if (portMatch.Success)
            {
                int parsed;
                if (int.TryParse(
                        portMatch.Groups[1].Value,
                        NumberStyles.Integer,
                        CultureInfo.InvariantCulture,
                        out parsed) &&
                    parsed >= 1 && parsed <= 65535)
                {
                    port = parsed;
                }
            }

            Match tokenMatch = Regex.Match(json, "\"token\"\\s*:\\s*\"([^\"]*)\"");
            if (tokenMatch.Success)
            {
                token = tokenMatch.Groups[1].Value.Trim();
            }
        }

        /* -------------------------------------------------------------- */
        /* process control                                                */
        /* -------------------------------------------------------------- */

        private static bool StartHelper()
        {
            if (!File.Exists(helperPath))
            {
                return false;
            }

            // ShellExecute (instead of CreateProcess with handle inheritance) is
            // what keeps the helper from inheriting our stdio pipes. Chromium
            // reads this host's stdout until EOF, so a long running child that
            // held that pipe would stall sendNativeMessage.
            ProcessStartInfo info = new ProcessStartInfo(helperPath);
            info.WorkingDirectory = baseDir;
            info.UseShellExecute = true;
            info.WindowStyle = ProcessWindowStyle.Hidden;

            Process.Start(info);
            return true;
        }

        /* -------------------------------------------------------------- */
        /* handle inheritance                                             */
        /* -------------------------------------------------------------- */


        private static void StopHelper()
        {
            try
            {
                foreach (Process process in Process.GetProcessesByName("PixivOneDriveHelper"))
                {
                    try
                    {
                        process.Kill();
                        process.WaitForExit(3000);
                    }
                    catch (Exception)
                    {
                        // ignore a single stubborn process
                    }
                }
            }
            catch (Exception)
            {
                // ignore
            }
        }

        private static bool IsListening(int candidatePort)
        {
            if (candidatePort < 1 || candidatePort > 65535)
            {
                return false;
            }

            try
            {
                using (TcpClient client = new TcpClient())
                {
                    IAsyncResult result = client.BeginConnect("127.0.0.1", candidatePort, null, null);
                    if (!result.AsyncWaitHandle.WaitOne(400))
                    {
                        return false;
                    }
                    client.EndConnect(result);
                    return true;
                }
            }
            catch (Exception)
            {
                return false;
            }
        }

        /* -------------------------------------------------------------- */
        /* native messaging framing                                       */
        /* -------------------------------------------------------------- */

        private static string ReadNativeMessage()
        {
            Stream stdin = Console.OpenStandardInput();
            byte[] lengthBytes = ReadExactly(stdin, 4);
            if (lengthBytes == null)
            {
                return "{}";
            }

            int length = BitConverter.ToInt32(lengthBytes, 0);
            if (length <= 0 || length > 1024 * 1024)
            {
                return "{}";
            }

            byte[] payload = ReadExactly(stdin, length);
            if (payload == null)
            {
                return "{}";
            }

            return Encoding.UTF8.GetString(payload);
        }

        private static byte[] ReadExactly(Stream stream, int count)
        {
            byte[] buffer = new byte[count];
            int offset = 0;
            while (offset < count)
            {
                int read = stream.Read(buffer, offset, count - offset);
                if (read <= 0)
                {
                    return null;
                }
                offset += read;
            }
            return buffer;
        }

        private static void WriteNativeMessage(string json)
        {
            byte[] payload = Encoding.UTF8.GetBytes(json);
            Stream stdout = Console.OpenStandardOutput();
            byte[] lengthBytes = BitConverter.GetBytes(payload.Length);
            stdout.Write(lengthBytes, 0, 4);
            stdout.Write(payload, 0, payload.Length);
            stdout.Flush();
        }

        private static string BuildResponse(
            bool ok, bool alreadyRunning, bool started, int elapsedMs, string error)
        {
            StringBuilder builder = new StringBuilder();
            builder.Append("{\"ok\":").Append(ok ? "true" : "false");
            builder.Append(",\"alreadyRunning\":").Append(alreadyRunning ? "true" : "false");
            builder.Append(",\"started\":").Append(started ? "true" : "false");
            builder.Append(",\"port\":").Append(port.ToString(CultureInfo.InvariantCulture));
            builder.Append(",\"elapsedMs\":").Append(elapsedMs.ToString(CultureInfo.InvariantCulture));
            builder.Append(",\"hasToken\":").Append(token.Length > 0 ? "true" : "false");
            if (!string.IsNullOrEmpty(error))
            {
                builder.Append(",\"error\":\"").Append(EscapeJson(error)).Append('"');
            }
            builder.Append('}');
            return builder.ToString();
        }

        private static string EscapeJson(string value)
        {
            StringBuilder builder = new StringBuilder(value.Length + 8);
            foreach (char c in value)
            {
                switch (c)
                {
                    case '"': builder.Append("\\\""); break;
                    case '\\': builder.Append("\\\\"); break;
                    case '\r': builder.Append("\\r"); break;
                    case '\n': builder.Append("\\n"); break;
                    case '\t': builder.Append("\\t"); break;
                    default:
                        if (c < ' ')
                        {
                            builder.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            builder.Append(c);
                        }
                        break;
                }
            }
            return builder.ToString();
        }

        /* -------------------------------------------------------------- */
        /* logging                                                        */
        /* -------------------------------------------------------------- */

        private static void Log(string message)
        {
            try
            {
                FileInfo info = new FileInfo(logPath);
                if (info.Exists && info.Length > LogLimitBytes)
                {
                    File.Delete(logPath);
                }

                string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) +
                              "  " + message + Environment.NewLine;
                File.AppendAllText(logPath, line, new UTF8Encoding(false));
            }
            catch (Exception)
            {
                // Logging must never break the launch.
            }
        }
    }
}
