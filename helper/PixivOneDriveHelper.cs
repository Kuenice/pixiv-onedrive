using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace PixivOneDriveHelper
{
    public sealed class Config
    {
        public int port { get; set; }
        public string token { get; set; }
        public string downloadDir { get; set; }
        public int maxConcurrentJobs { get; set; }

        public Config()
        {
            port = 39391;
            token = "";
            downloadDir = "";
            maxConcurrentJobs = 2;
        }

        public static Config Load(string path)
        {
            if (!File.Exists(path))
            {
                throw new FileNotFoundException("找不到配置文件", path);
            }

            string json = File.ReadAllText(path, Encoding.UTF8);
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            Config cfg = serializer.Deserialize<Config>(json);
            if (cfg == null)
            {
                throw new InvalidOperationException("配置文件内容无效");
            }

            if (cfg.token != null)
            {
                cfg.token = cfg.token.Trim();
            }
            if (cfg.downloadDir != null)
            {
                cfg.downloadDir = cfg.downloadDir.Trim();
            }
            return cfg;
        }
    }

    public sealed class DownloadRequest
    {
        public string token { get; set; }
        public string pid { get; set; }
        public string title { get; set; }
        public string artist { get; set; }
        public string pageUrl { get; set; }
        public List<FileSpec> files { get; set; }
    }

    public sealed class FileSpec
    {
        public int index { get; set; }
        public string url { get; set; }
        public string ext { get; set; }
    }

    internal sealed class DownloadJob
    {
        public string pid;
        public string referer;
        public List<FileSpec> files;
    }

    internal static class Program
    {
        private const string HelperVersion = "1.0.1";
        private const string UserAgent =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";

        private static readonly HashSet<string> AllowedExtensions =
            new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "jpg", "jpeg", "png", "gif", "webp", "zip"
            };

        private static readonly object LogLock = new object();

        private static Config config;
        private static BlockingCollection<DownloadJob> queue;
        private static HttpClient http;
        private static Mutex mutex;
        private static string logPath;
        private static DateTime startedUtc = DateTime.UtcNow;

        private static int activeCount;
        private static int doneCount;
        private static int failedCount;
        private static int skippedCount;

        [STAThread]
        private static int Main(string[] args)
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            logPath = Path.Combine(baseDir, "helper.log");

            try
            {
                config = Config.Load(Path.Combine(baseDir, "config.json"));

                if (string.IsNullOrEmpty(config.token))
                {
                    throw new InvalidOperationException("config.json 中缺少 token");
                }
                if (string.IsNullOrEmpty(config.downloadDir))
                {
                    throw new InvalidOperationException("config.json 中缺少 downloadDir");
                }
                if (config.port < 1 || config.port > 65535)
                {
                    throw new InvalidOperationException("config.json 中的 port 无效");
                }
                if (config.maxConcurrentJobs < 1)
                {
                    config.maxConcurrentJobs = 1;
                }
                if (config.maxConcurrentJobs > 4)
                {
                    config.maxConcurrentJobs = 4;
                }

                Directory.CreateDirectory(config.downloadDir);

                bool createdNew;
                mutex = new Mutex(true, "PixivOneDriveHelper_SingleInstance", out createdNew);
                if (!createdNew)
                {
                    Log("另一个 PixivOneDriveHelper 已在运行，本进程退出。");
                    return 0;
                }

                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                ServicePointManager.DefaultConnectionLimit = 16;

                HttpClientHandler handler = new HttpClientHandler();
                handler.AutomaticDecompression =
                    DecompressionMethods.GZip | DecompressionMethods.Deflate;
                handler.UseCookies = false;

                http = new HttpClient(handler);
                http.Timeout = TimeSpan.FromMinutes(10);
                http.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", UserAgent);

                queue = new BlockingCollection<DownloadJob>(
                    new ConcurrentQueue<DownloadJob>(), 500);

                for (int i = 0; i < config.maxConcurrentJobs; i++)
                {
                    Task.Run(async () =>
                    {
                        try
                        {
                            foreach (DownloadJob job in queue.GetConsumingEnumerable())
                            {
                                await ProcessJobAsync(job).ConfigureAwait(false);
                            }
                        }
                        catch (Exception ex)
                        {
                            Log("下载工作线程退出: " + ex);
                        }
                    });
                }

                HttpListener listener = new HttpListener();
                listener.Prefixes.Add(
                    "http://127.0.0.1:" +
                    config.port.ToString(CultureInfo.InvariantCulture) +
                    "/");
                listener.Start();

                Log(
                    "助手已启动。版本=" + HelperVersion +
                    " 端口=" + config.port.ToString(CultureInfo.InvariantCulture) +
                    " 保存目录=" + config.downloadDir);

                while (true)
                {
                    HttpListenerContext context = listener.GetContext();
                    ThreadPool.QueueUserWorkItem(HandleContext, context);
                }
            }
            catch (Exception ex)
            {
                Log("启动失败: " + ex);
                return 1;
            }
        }

        private static void HandleContext(object state)
        {
            HttpListenerContext context = (HttpListenerContext)state;
            HttpListenerRequest request = context.Request;
            HttpListenerResponse response = context.Response;

            try
            {
                AddCorsHeaders(response);

                if (string.Equals(request.HttpMethod, "OPTIONS", StringComparison.OrdinalIgnoreCase))
                {
                    response.StatusCode = 204;
                    return;
                }

                string path = request.Url == null ? "/" : request.Url.AbsolutePath;
                path = path.TrimEnd('/');
                if (path.Length == 0)
                {
                    path = "/";
                }

                if (path == "/health" &&
                    string.Equals(request.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase))
                {
                    HandleHealth(request, response);
                    return;
                }

                if (path == "/download" &&
                    string.Equals(request.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
                {
                    HandleDownload(request, response);
                    return;
                }

                if (path == "/open-folder" &&
                    string.Equals(request.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
                {
                    HandleOpenFolder(request, response);
                    return;
                }

                WriteError(response, 404, "未知接口");
            }
            catch (Exception ex)
            {
                Log("处理请求失败: " + ex);
                try
                {
                    WriteError(response, 500, "本地助手内部错误");
                }
                catch (Exception writeError)
                {
                    Log("写入错误响应失败: " + writeError.Message);
                }
            }
            finally
            {
                try
                {
                    response.OutputStream.Close();
                }
                catch (Exception)
                {
                    // 客户端可能已经断开。
                }
            }
        }

        private static void HandleHealth(HttpListenerRequest request, HttpListenerResponse response)
        {
            if (!CheckToken(request, null))
            {
                WriteError(response, 401, "令牌无效");
                return;
            }

            int queued = 0;
            if (queue != null)
            {
                queued = queue.Count;
            }

            WriteJson(response, 200, new
            {
                ok = true,
                version = HelperVersion,
                downloadDir = config.downloadDir,
                queued = queued,
                active = activeCount,
                done = doneCount,
                failed = failedCount,
                skipped = skippedCount,
                uptimeSeconds = (long)(DateTime.UtcNow - startedUtc).TotalSeconds
            });
        }

        private static void HandleDownload(HttpListenerRequest request, HttpListenerResponse response)
        {
            string body;
            try
            {
                body = ReadBody(request, 1024 * 1024);
            }
            catch (Exception ex)
            {
                WriteError(response, 413, ex.Message);
                return;
            }

            DownloadRequest payload;
            try
            {
                payload = new JavaScriptSerializer().Deserialize<DownloadRequest>(body);
            }
            catch (Exception)
            {
                WriteError(response, 400, "请求 JSON 无效");
                return;
            }

            if (payload == null)
            {
                WriteError(response, 400, "请求内容为空");
                return;
            }

            if (!CheckToken(request, payload.token))
            {
                WriteError(response, 401, "令牌无效");
                return;
            }

            if (!IsDigits(payload.pid))
            {
                WriteError(response, 400, "作品 ID 无效");
                return;
            }

            if (payload.files == null || payload.files.Count < 1 || payload.files.Count > 200)
            {
                WriteError(response, 400, "图片数量无效");
                return;
            }

            List<FileSpec> validFiles = new List<FileSpec>();
            HashSet<int> indexes = new HashSet<int>();

            foreach (FileSpec file in payload.files)
            {
                FileSpec valid = ValidateFile(file, indexes);
                if (valid == null)
                {
                    WriteError(response, 400, "包含无效的图片地址、序号或扩展名");
                    return;
                }
                validFiles.Add(valid);
            }

            DownloadJob job = new DownloadJob();
            job.pid = payload.pid;
            job.referer = BuildReferer(payload.pageUrl, payload.pid);
            job.files = validFiles;

            if (!queue.TryAdd(job))
            {
                WriteError(response, 503, "下载队列已满，请稍后再试");
                return;
            }

            Log(
                "已加入队列: pid=" + job.pid +
                " 数量=" + validFiles.Count.ToString(CultureInfo.InvariantCulture) +
                " 标题=" + (payload.title ?? ""));

            WriteJson(response, 202, new
            {
                ok = true,
                queued = validFiles.Count,
                pid = job.pid
            });
        }

        private static void HandleOpenFolder(HttpListenerRequest request, HttpListenerResponse response)
        {
            if (!CheckToken(request, null))
            {
                WriteError(response, 401, "令牌无效");
                return;
            }

            try
            {
                Directory.CreateDirectory(config.downloadDir);
                ProcessStartInfo startInfo = new ProcessStartInfo();
                startInfo.FileName = "explorer.exe";
                startInfo.Arguments = "\"" + config.downloadDir + "\"";
                startInfo.UseShellExecute = true;
                System.Diagnostics.Process.Start(startInfo);
                WriteJson(response, 200, new { ok = true });
            }
            catch (Exception ex)
            {
                Log("打开文件夹失败: " + ex.Message);
                WriteError(response, 500, "无法打开文件夹");
            }
        }

        private static FileSpec ValidateFile(FileSpec file, HashSet<int> indexes)
        {
            if (file == null)
            {
                return null;
            }
            if (file.index < 0 || file.index > 9999 || indexes.Contains(file.index))
            {
                return null;
            }

            Uri uri;
            if (!Uri.TryCreate(file.url, UriKind.Absolute, out uri))
            {
                return null;
            }
            if (!string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            string host = uri.Host.ToLowerInvariant();
            if (host != "i.pximg.net" && !host.EndsWith(".pximg.net", StringComparison.Ordinal))
            {
                return null;
            }

            string path = uri.AbsolutePath;
            if (!path.StartsWith("/img-original/", StringComparison.Ordinal) &&
                !path.StartsWith("/img-zip-ugoira/", StringComparison.Ordinal))
            {
                return null;
            }

            string ext = NormalizeExtension(file.ext, uri);
            if (ext == null)
            {
                return null;
            }

            FileSpec result = new FileSpec();
            result.index = file.index;
            result.url = uri.AbsoluteUri;
            result.ext = ext;
            indexes.Add(file.index);
            return result;
        }

        private static string NormalizeExtension(string requested, Uri uri)
        {
            string ext = (requested ?? "").Trim().TrimStart('.').ToLowerInvariant();
            if (AllowedExtensions.Contains(ext))
            {
                return ext;
            }

            string fromUrl = Path.GetExtension(uri.AbsolutePath);
            fromUrl = (fromUrl ?? "").TrimStart('.').ToLowerInvariant();
            if (AllowedExtensions.Contains(fromUrl))
            {
                return fromUrl;
            }

            return null;
        }

        private static string BuildReferer(string pageUrl, string pid)
        {
            Uri uri;
            if (!string.IsNullOrEmpty(pageUrl) &&
                Uri.TryCreate(pageUrl, UriKind.Absolute, out uri) &&
                string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) &&
                (string.Equals(uri.Host, "www.pixiv.net", StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(uri.Host, "pixiv.net", StringComparison.OrdinalIgnoreCase)))
            {
                return uri.AbsoluteUri;
            }

            return "https://www.pixiv.net/artworks/" + pid;
        }

        private static async Task ProcessJobAsync(DownloadJob job)
        {
            Interlocked.Increment(ref activeCount);
            int success = 0;
            int failed = 0;

            try
            {
                foreach (FileSpec file in job.files)
                {
                    bool ok = await DownloadFileWithRetriesAsync(job, file).ConfigureAwait(false);
                    if (ok)
                    {
                        success++;
                    }
                    else
                    {
                        failed++;
                    }
                }
            }
            catch (Exception ex)
            {
                failed++;
                Log("任务异常: pid=" + job.pid + " " + ex);
            }
            finally
            {
                Interlocked.Decrement(ref activeCount);
                Log(
                    "任务完成: pid=" + job.pid +
                    " 成功=" + success.ToString(CultureInfo.InvariantCulture) +
                    " 失败=" + failed.ToString(CultureInfo.InvariantCulture));
            }
        }

        private static async Task<bool> DownloadFileWithRetriesAsync(DownloadJob job, FileSpec file)
        {
            Exception lastError = null;

            for (int attempt = 1; attempt <= 3; attempt++)
            {
                bool retry = false;
                try
                {
                    await DownloadFileAsync(job, file).ConfigureAwait(false);
                    return true;
                }
                catch (Exception ex)
                {
                    lastError = ex;
                    retry = attempt < 3;
                }

                if (retry)
                {
                    await Task.Delay(800 * attempt).ConfigureAwait(false);
                }
            }

            Interlocked.Increment(ref failedCount);
            Log(
                "下载失败: pid=" + job.pid +
                " 第=" + file.index.ToString(CultureInfo.InvariantCulture) +
                " " + (lastError == null ? "未知错误" : lastError.Message));
            return false;
        }

        private static async Task DownloadFileAsync(DownloadJob job, FileSpec file)
        {
            Directory.CreateDirectory(config.downloadDir);

            string fileName =
                job.pid + "_p" +
                file.index.ToString(CultureInfo.InvariantCulture) +
                "." + file.ext;
            string targetPath = Path.Combine(config.downloadDir, fileName);

            if (File.Exists(targetPath))
            {
                Interlocked.Increment(ref skippedCount);
                Log("已存在，跳过: " + targetPath);
                return;
            }

            string tempPath = targetPath + "." + Guid.NewGuid().ToString("N") + ".part";

            try
            {
                using (HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Get, file.url))
                {
                    request.Headers.Referrer = new Uri(job.referer);
                    request.Headers.TryAddWithoutValidation("User-Agent", UserAgent);
                    request.Headers.TryAddWithoutValidation(
                        "Accept",
                        "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");
                    request.Headers.TryAddWithoutValidation("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");

                    using (HttpResponseMessage response = await http.SendAsync(
                        request,
                        HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false))
                    {
                        if (!response.IsSuccessStatusCode)
                        {
                            throw new InvalidOperationException(
                                "HTTP " + ((int)response.StatusCode).ToString(CultureInfo.InvariantCulture));
                        }

                        string mediaType = "";
                        if (response.Content.Headers.ContentType != null &&
                            response.Content.Headers.ContentType.MediaType != null)
                        {
                            mediaType = response.Content.Headers.ContentType.MediaType;
                        }
                        if (mediaType.StartsWith("text/", StringComparison.OrdinalIgnoreCase))
                        {
                            throw new InvalidOperationException("服务器返回了文本而不是图片");
                        }

                        using (Stream input = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                        using (FileStream output = new FileStream(
                            tempPath,
                            FileMode.CreateNew,
                            FileAccess.Write,
                            FileShare.None,
                            81920,
                            true))
                        {
                            await input.CopyToAsync(output).ConfigureAwait(false);
                        }
                    }
                }

                if (!ValidateFileContent(tempPath, file.ext))
                {
                    throw new InvalidOperationException("下载内容与扩展名不匹配");
                }

                if (File.Exists(targetPath))
                {
                    File.Delete(tempPath);
                    Interlocked.Increment(ref skippedCount);
                    Log("已存在，跳过: " + targetPath);
                    return;
                }

                File.Move(tempPath, targetPath);
                Interlocked.Increment(ref doneCount);
                Log("已保存: " + targetPath);
            }
            finally
            {
                try
                {
                    if (File.Exists(tempPath))
                    {
                        File.Delete(tempPath);
                    }
                }
                catch (Exception)
                {
                    // 临时文件留待人工清理。
                }
            }
        }

        private static bool ValidateFileContent(string path, string ext)
        {
            FileInfo info = new FileInfo(path);
            if (!info.Exists || info.Length <= 0)
            {
                return false;
            }

            byte[] head = new byte[12];
            int read;
            using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                read = stream.Read(head, 0, head.Length);
            }

            if (read < 2)
            {
                return false;
            }

            if (ext == "jpg" || ext == "jpeg")
            {
                return head[0] == 0xFF && head[1] == 0xD8;
            }
            if (ext == "png")
            {
                return read >= 8 &&
                    head[0] == 0x89 && head[1] == 0x50 && head[2] == 0x4E && head[3] == 0x47 &&
                    head[4] == 0x0D && head[5] == 0x0A && head[6] == 0x1A && head[7] == 0x0A;
            }
            if (ext == "gif")
            {
                return read >= 4 &&
                    head[0] == 0x47 && head[1] == 0x49 && head[2] == 0x46 && head[3] == 0x38;
            }
            if (ext == "webp")
            {
                return read >= 12 &&
                    head[0] == 0x52 && head[1] == 0x49 && head[2] == 0x46 && head[3] == 0x46 &&
                    head[8] == 0x57 && head[9] == 0x45 && head[10] == 0x42 && head[11] == 0x50;
            }
            if (ext == "zip")
            {
                return read >= 4 &&
                    head[0] == 0x50 && head[1] == 0x4B &&
                    (head[2] == 0x03 || head[2] == 0x05) &&
                    (head[3] == 0x04 || head[3] == 0x06);
            }

            return true;
        }

        private static string ReadBody(HttpListenerRequest request, int maxBytes)
        {
            if (request.ContentLength64 > maxBytes)
            {
                throw new InvalidOperationException("请求体过大");
            }

            Encoding encoding = request.ContentEncoding ?? Encoding.UTF8;
            using (StreamReader reader = new StreamReader(request.InputStream, encoding))
            {
                char[] buffer = new char[8192];
                StringBuilder builder = new StringBuilder();
                int read;
                while ((read = reader.Read(buffer, 0, buffer.Length)) > 0)
                {
                    builder.Append(buffer, 0, read);
                    if (builder.Length > maxBytes)
                    {
                        throw new InvalidOperationException("请求体过大");
                    }
                }
                return builder.ToString();
            }
        }

        private static bool CheckToken(HttpListenerRequest request, string bodyToken)
        {
            string provided = request.Headers["X-Pixiv-Token"];
            if (string.IsNullOrEmpty(provided))
            {
                provided = bodyToken;
            }
            return ConstantTimeEquals(provided, config.token);
        }

        private static bool ConstantTimeEquals(string left, string right)
        {
            if (left == null || right == null || left.Length != right.Length)
            {
                return false;
            }

            int difference = 0;
            for (int i = 0; i < left.Length; i++)
            {
                difference |= left[i] ^ right[i];
            }
            return difference == 0;
        }

        private static bool IsDigits(string value)
        {
            if (string.IsNullOrEmpty(value) || value.Length > 20)
            {
                return false;
            }

            for (int i = 0; i < value.Length; i++)
            {
                if (value[i] < '0' || value[i] > '9')
                {
                    return false;
                }
            }
            return true;
        }

        private static void AddCorsHeaders(HttpListenerResponse response)
        {
            response.Headers["Access-Control-Allow-Origin"] = "*";
            response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
            response.Headers["Access-Control-Allow-Headers"] = "Content-Type, X-Pixiv-Token";
            response.Headers["Access-Control-Max-Age"] = "86400";
            response.Headers["Access-Control-Allow-Private-Network"] = "true";
        }

        private static void WriteJson(HttpListenerResponse response, int statusCode, object payload)
        {
            string json = new JavaScriptSerializer().Serialize(payload);
            byte[] bytes = Encoding.UTF8.GetBytes(json);

            response.StatusCode = statusCode;
            response.ContentType = "application/json; charset=utf-8";
            response.ContentEncoding = Encoding.UTF8;
            response.ContentLength64 = bytes.Length;
            response.OutputStream.Write(bytes, 0, bytes.Length);
        }

        private static void WriteError(HttpListenerResponse response, int statusCode, string message)
        {
            WriteJson(response, statusCode, new
            {
                ok = false,
                error = message
            });
        }

        private static void Log(string message)
        {
            lock (LogLock)
            {
                try
                {
                    if (logPath == null)
                    {
                        return;
                    }

                    if (File.Exists(logPath))
                    {
                        FileInfo info = new FileInfo(logPath);
                        if (info.Length > 2 * 1024 * 1024)
                        {
                            string oldPath = logPath + ".1";
                            if (File.Exists(oldPath))
                            {
                                File.Delete(oldPath);
                            }
                            File.Move(logPath, oldPath);
                        }
                    }

                    string line =
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) +
                        "  " + message + Environment.NewLine;
                    File.AppendAllText(logPath, line, new UTF8Encoding(true));
                }
                catch (Exception)
                {
                    // 日志失败不能影响下载。
                }
            }
        }
    }
}
