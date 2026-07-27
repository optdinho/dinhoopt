using DiNho.Capture.Poc.Ipc;
using DiNho.Capture.Poc.Logging;
using System.Text.Json;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator
{
    private IpcMessage HandleClipsMessages(IpcMessage msg, string action)
    {
        return action switch
        {
            "listClips" => HandleListClips(),
            "deleteClip" => HandleDeleteClip(msg),
            "renameClip" => HandleRenameClip(msg),
            _ => throw new InvalidOperationException($"Unexpected clips action: {action}")
        };
    }

    private IpcMessage HandleListClips()
    {
        try
        {
            var dir = GetOutputDirectory();
            var files = Directory.GetFiles(dir, "*.mp4")
                .Select(f => new FileInfo(f))
                .OrderByDescending(f => f.CreationTime)
                .Select(f => new
                {
                    name = f.Name,
                    path = f.FullName,
                    sizeBytes = f.Length,
                    creationTime = f.CreationTime.ToString("o")
                })
                .ToList();

            return new IpcMessage
            {
                Action = "clipsList",
                Value = JsonSerializer.SerializeToElement(new { clips = files })
            };
        }
        catch (Exception ex)
        {
            Log.E("EngineCoordinator", $"listClips failed: {ex.Message}");
            return new IpcMessage
            {
                Action = "error",
                Value = JsonSerializer.SerializeToElement(new { error = ex.Message })
            };
        }
    }

    private IpcMessage HandleDeleteClip(IpcMessage msg)
    {
        try
        {
            if (!msg.Value.HasValue)
                return new IpcMessage { Action = "error", Value = JsonSerializer.SerializeToElement(new { error = "Missing clip name" }) };

            var clipName = msg.Value.Value.GetProperty("name").GetString() ?? "";
            var dir = GetOutputDirectory();
            var fullPath = Path.GetFullPath(Path.Combine(dir, clipName));

            // Path traversal protection: ensure resolved path is inside output directory
            if (!fullPath.StartsWith(dir, StringComparison.OrdinalIgnoreCase))
            {
                Log.W("EngineCoordinator", $"Path traversal attempt blocked: {clipName}");
                return new IpcMessage { Action = "error", Value = JsonSerializer.SerializeToElement(new { error = "Invalid path" }) };
            }

            if (!File.Exists(fullPath))
                return new IpcMessage { Action = "error", Value = JsonSerializer.SerializeToElement(new { error = "Clip not found" }) };

            File.Delete(fullPath);

            // Remove associated files (thumbnail, favorite marker)
            var thumbPath = Path.ChangeExtension(fullPath, ".thumb.jpg");
            if (File.Exists(thumbPath)) try { File.Delete(thumbPath); } catch (Exception ex) { Log.D("EngineCoordinator", $"deleteClip: thumbnail cleanup failed: {ex.Message}"); }
            var markerPath = Path.Combine(dir, $".{clipName}.favorite");
            if (File.Exists(markerPath)) try { File.Delete(markerPath); } catch (Exception ex) { Log.D("EngineCoordinator", $"deleteClip: favorite marker cleanup failed: {ex.Message}"); }

            Log.I("EngineCoordinator", $"Clip deleted: {clipName}");
            return new IpcMessage { Action = "ok" };
        }
        catch (Exception ex)
        {
            Log.E("EngineCoordinator", $"deleteClip failed: {ex.Message}");
            return new IpcMessage { Action = "error", Value = JsonSerializer.SerializeToElement(new { error = ex.Message }) };
        }
    }

    private IpcMessage HandleRenameClip(IpcMessage msg)
    {
        try
        {
            if (!msg.Value.HasValue)
                return new IpcMessage { Action = "error", Value = JsonSerializer.SerializeToElement(new { error = "Missing parameters" }) };

            var oldName = msg.Value.Value.GetProperty("oldName").GetString() ?? "";
            var newName = msg.Value.Value.GetProperty("newName").GetString() ?? "";

            if (string.IsNullOrEmpty(oldName) || string.IsNullOrEmpty(newName))
                return new IpcMessage { Action = "error", Value = JsonSerializer.SerializeToElement(new { error = "Invalid names" }) };

            var dir = GetOutputDirectory();
            var oldPath = Path.GetFullPath(Path.Combine(dir, oldName));
            var newPath = Path.GetFullPath(Path.Combine(dir, newName));

            // Path traversal protection
            if (!oldPath.StartsWith(dir, StringComparison.OrdinalIgnoreCase) ||
                !newPath.StartsWith(dir, StringComparison.OrdinalIgnoreCase))
            {
                Log.W("EngineCoordinator", $"Path traversal attempt blocked: {oldName} → {newName}");
                return new IpcMessage { Action = "error", Value = JsonSerializer.SerializeToElement(new { error = "Invalid path" }) };
            }

            if (!File.Exists(oldPath))
                return new IpcMessage { Action = "error", Value = JsonSerializer.SerializeToElement(new { error = "Clip not found" }) };

            if (File.Exists(newPath))
                return new IpcMessage { Action = "error", Value = JsonSerializer.SerializeToElement(new { error = "Destination already exists" }) };

            File.Move(oldPath, newPath);

            // Rename associated thumbnail
            var oldThumb = Path.ChangeExtension(oldPath, ".thumb.jpg");
            var newThumb = Path.ChangeExtension(newPath, ".thumb.jpg");
            if (File.Exists(oldThumb)) try { File.Move(oldThumb, newThumb); } catch (Exception ex) { Log.D("EngineCoordinator", $"renameClip: thumbnail rename failed: {ex.Message}"); }

            Log.I("EngineCoordinator", $"Clip renamed: {oldName} → {newName}");
            return new IpcMessage { Action = "ok" };
        }
        catch (Exception ex)
        {
            Log.E("EngineCoordinator", $"renameClip failed: {ex.Message}");
            return new IpcMessage { Action = "error", Value = JsonSerializer.SerializeToElement(new { error = ex.Message }) };
        }
    }
}
