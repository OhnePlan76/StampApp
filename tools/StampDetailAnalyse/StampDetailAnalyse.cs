using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

internal static class StampDetailAnalyse
{
    private const string DefaultProjectRoot = @"D:\Apps\stamp-value-app";
    private const string OllamaUrl = "http://127.0.0.1:11434";
    private const string WarmupImageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

    private static int Main(string[] args)
    {
        var options = Options.Parse(args);
        var projectRoot = FindProjectRoot();

        Console.Title = "StampApp Detailanalyse";
        Console.WriteLine("StampApp Detailanalyse");
        Console.WriteLine("Projekt: " + projectRoot);
        Console.WriteLine("Modell:  " + options.Model);
        Console.WriteLine("Warm:    " + options.KeepAlive);
        Console.WriteLine("Port:    " + options.Port);
        Console.WriteLine("Browser: " + (!options.NoBrowser));
        Console.WriteLine();

        try
        {
            EnsureProject(projectRoot);
            EnsureOllama();

            if (!options.NoWarmup)
            {
                WarmupModel(options);
            }

            StartReview(projectRoot, options);

            Console.WriteLine();
            Console.WriteLine("Detailanalyse bereit: http://127.0.0.1:" + options.Port);
            Console.WriteLine("Dort Seiten sichten, Markierungen setzen und 'Ausschnitt bewerten' nutzen.");
            Pause();
            return 0;
        }
        catch (Exception ex)
        {
            Console.WriteLine();
            Console.WriteLine("Fehler: " + ex.Message);
            Pause();
            return 1;
        }
    }

    private static string FindProjectRoot()
    {
        var exeDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');

        if (File.Exists(Path.Combine(exeDir, "package.json")) &&
            Directory.Exists(Path.Combine(exeDir, "scripts")))
        {
            return exeDir;
        }

        if (File.Exists(Path.Combine(DefaultProjectRoot, "package.json")) &&
            Directory.Exists(Path.Combine(DefaultProjectRoot, "scripts")))
        {
            return DefaultProjectRoot;
        }

        return exeDir;
    }

    private static void EnsureProject(string projectRoot)
    {
        var review = Path.Combine(projectRoot, "scripts", "start-analysis-review.ps1");
        var packageJson = Path.Combine(projectRoot, "package.json");

        if (!File.Exists(packageJson))
        {
            throw new FileNotFoundException("package.json wurde nicht gefunden: " + packageJson);
        }

        if (!File.Exists(review))
        {
            throw new FileNotFoundException("Review-Starter wurde nicht gefunden: " + review);
        }
    }

    private static void EnsureOllama()
    {
        if (OllamaIsReachable())
        {
            Console.WriteLine("Ollama: erreichbar");
            return;
        }

        Console.WriteLine("Ollama: nicht erreichbar, starte Ollama...");
        var startInfo = new ProcessStartInfo
        {
            FileName = FindOllamaExecutable(),
            Arguments = "serve",
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        Process.Start(startInfo);

        for (var attempt = 0; attempt < 30; attempt++)
        {
            Thread.Sleep(1000);
            if (OllamaIsReachable())
            {
                Console.WriteLine("Ollama: gestartet");
                return;
            }
        }

        throw new TimeoutException("Ollama antwortet nicht auf " + OllamaUrl + ".");
    }

    private static bool OllamaIsReachable()
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create(OllamaUrl + "/api/tags");
            request.Method = "GET";
            request.Timeout = 3000;

            using (var response = (HttpWebResponse)request.GetResponse())
            {
                return (int)response.StatusCode >= 200 && (int)response.StatusCode < 300;
            }
        }
        catch
        {
            return false;
        }
    }

    private static string FindOllamaExecutable()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var candidates = new[]
        {
            "ollama.exe",
            Path.Combine(localAppData, "Programs", "Ollama", "ollama.exe"),
            @"C:\Program Files\Ollama\ollama.exe",
        };

        foreach (var candidate in candidates)
        {
            if (candidate == "ollama.exe" || File.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new FileNotFoundException("Ollama wurde nicht gefunden.");
    }

    private static void WarmupModel(Options options)
    {
        Console.WriteLine("Warmup: lade " + options.Model + ", keep_alive=" + options.KeepAlive);
        var startedAt = DateTime.UtcNow;
        var json =
            "{\"model\":\"" + JsonEscape(options.Model) + "\"," +
            "\"prompt\":\"Antworte ausschliesslich als JSON: {\\\"ok\\\":true}\"," +
            "\"images\":[\"" + WarmupImageBase64 + "\"]," +
            "\"stream\":false," +
            "\"format\":\"json\"," +
            "\"keep_alive\":\"" + JsonEscape(options.KeepAlive) + "\"," +
            "\"options\":{\"num_predict\":20,\"temperature\":0}}";

        var request = (HttpWebRequest)WebRequest.Create(OllamaUrl + "/api/generate");
        request.Method = "POST";
        request.ContentType = "application/json";
        request.Timeout = options.WarmupTimeoutSeconds * 1000;

        var body = Encoding.UTF8.GetBytes(json);
        using (var stream = request.GetRequestStream())
        {
            stream.Write(body, 0, body.Length);
        }

        using ((HttpWebResponse)request.GetResponse())
        {
            // Body is not needed; successful response means the model is warm.
        }

        var seconds = (int)Math.Round((DateTime.UtcNow - startedAt).TotalSeconds);
        Console.WriteLine("Warmup fertig nach " + seconds + "s.");
    }

    private static void StartReview(string projectRoot, Options options)
    {
        Console.WriteLine();
        Console.WriteLine("Starte genaue Analyse-Oberflaeche...");

        var scriptPath = Path.Combine(projectRoot, "scripts", "start-analysis-review.ps1");
        var arguments =
            "-NoExit -ExecutionPolicy Bypass -File " + Quote(scriptPath) +
            " -Port " + options.Port;

        if (options.NoBrowser) arguments += " -NoBrowser";

        var startInfo = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = arguments,
            WorkingDirectory = projectRoot,
            UseShellExecute = true,
        };

        Process.Start(startInfo);
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    private static string JsonEscape(string value)
    {
        return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }

    private static void Pause()
    {
        if (Environment.UserInteractive)
        {
            Console.WriteLine();
            Console.WriteLine("Enter druecken zum Schliessen...");
            Console.ReadLine();
        }
    }

    private sealed class Options
    {
        public string Model = Environment.GetEnvironmentVariable("OLLAMA_VISION_MODEL") ?? "llava:7b";
        public string KeepAlive = Environment.GetEnvironmentVariable("OLLAMA_SESSION_KEEP_ALIVE") ?? "30m";
        public int Port = 5791;
        public int WarmupTimeoutSeconds = 240;
        public bool NoWarmup;
        public bool NoBrowser;

        public static Options Parse(string[] args)
        {
            var options = new Options();

            for (var i = 0; i < args.Length; i++)
            {
                var arg = args[i];
                if (arg == "--no-warmup") options.NoWarmup = true;
                else if (arg == "--no-browser") options.NoBrowser = true;
                else if (arg == "--model" && i + 1 < args.Length) options.Model = args[++i];
                else if (arg.StartsWith("--model=")) options.Model = arg.Substring("--model=".Length);
                else if (arg == "--keep-alive" && i + 1 < args.Length) options.KeepAlive = args[++i];
                else if (arg.StartsWith("--keep-alive=")) options.KeepAlive = arg.Substring("--keep-alive=".Length);
                else if (arg == "--port" && i + 1 < args.Length) options.Port = int.Parse(args[++i]);
                else if (arg.StartsWith("--port=")) options.Port = int.Parse(arg.Substring("--port=".Length));
                else if (arg == "--warmup-timeout" && i + 1 < args.Length) options.WarmupTimeoutSeconds = int.Parse(args[++i]);
                else if (arg.StartsWith("--warmup-timeout=")) options.WarmupTimeoutSeconds = int.Parse(arg.Substring("--warmup-timeout=".Length));
                else if (arg == "--help" || arg == "-h" || arg == "/?")
                {
                    PrintHelp();
                    Environment.Exit(0);
                }
            }

            return options;
        }

        private static void PrintHelp()
        {
            Console.WriteLine("StampDetailAnalyse.exe [Optionen]");
            Console.WriteLine();
            Console.WriteLine("  --model NAME           Ollama-Modell, Standard llava:7b");
            Console.WriteLine("  --keep-alive DAUER     Ollama warm halten, Standard 30m");
            Console.WriteLine("  --port N               Review-Port, Standard 5791");
            Console.WriteLine("  --no-warmup            Modell-Warmup ueberspringen");
            Console.WriteLine("  --no-browser           Browser nicht automatisch oeffnen");
            Console.WriteLine("  --warmup-timeout SEK   Warmup-Timeout, Standard 240");
        }
    }
}
