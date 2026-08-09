import os
from win32com.client import Dispatch

desktop = os.path.join(os.path.expanduser("~"), "Desktop")
lnk_path = os.path.join(desktop, "\u5b89\u9633\u9ebb\u5c06.lnk")

target = r"C:\Users\tiank\WorkBuddy\2026-08-06-22-12-54\anyang-mahjong\launcher\node_modules\electron\dist\electron.exe"
work = r"C:\Users\tiank\WorkBuddy\2026-08-06-22-12-54\anyang-mahjong\launcher"

shell = Dispatch("WScript.Shell")
shortcut = shell.CreateShortcut(lnk_path)
shortcut.TargetPath = target
shortcut.Arguments = "."
shortcut.WorkingDirectory = work
shortcut.Description = "\u5b89\u9633\u9ebb\u5c06 · \u65e0\u8fb9\u6846\u542f\u52a8"
shortcut.IconLocation = r"C:\Users\tiank\WorkBuddy\2026-08-06-22-12-54\anyang-mahjong\launcher\icon_facai.ico"
shortcut.WindowStyle = 1
shortcut.Save()
print("created:", lnk_path)
