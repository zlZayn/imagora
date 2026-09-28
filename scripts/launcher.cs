using System;
using System.Diagnostics;
using System.IO;

/// <summary>
/// Imagora 启动器：双击本程序等同于双击 scripts\启动生图工作台.cmd。
/// 只做一件事——把该脚本交给 cmd.exe 执行，并透传退出码。
///
/// 为什么用 exe 而不是快捷方式（.lnk）：
///   .lnk 是 Windows Shell 对象，格式上必须记录目标的绝对路径，因此天生「机器相关」，
///   无法随仓库分发；而 exe 可以内嵌图标、可用相对路径定位脚本，换机器换目录都能用。
/// 编译方式见同目录 make_launcher.ps1（用的是 Windows 自带的 C# 编译器，无第三方依赖）。
/// </summary>
internal static class Launcher
{
    private static int Main()
    {
        // 以本程序所在目录为项目根：相对定位，仓库整体移动或换机器后依然成立
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string script = Path.Combine(root, "scripts", "启动生图工作台.cmd");

        if (!File.Exists(script))
        {
            Console.Error.WriteLine("找不到启动脚本：" + script);
            Console.Error.WriteLine("请把本程序放回项目根目录（与 scripts\\ 同级）后再运行。");
            Console.Error.WriteLine("按任意键退出……");
            Console.ReadKey(true);
            return 1;
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = Environment.GetEnvironmentVariable("COMSPEC") ?? "cmd.exe",
            // cmd /c ""<脚本路径>""：外层引号用于兼容含空格或中文的路径
            Arguments = "/c \"\"" + script + "\"\"",
            WorkingDirectory = root,
            UseShellExecute = false, // 继承本进程的控制台，双击只出现一个窗口
        };

        using (Process child = Process.Start(startInfo))
        {
            child.WaitForExit();
            return child.ExitCode;
        }
    }
}
