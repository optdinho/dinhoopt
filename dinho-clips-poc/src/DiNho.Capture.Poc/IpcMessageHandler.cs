using DiNho.Capture.Poc.Ipc;
using System.Text.Json;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator
{
    // ── IPC Message Handler ──
    // Dispatches to focused handler methods in partial class files:
    //   IpcMessageHandler.Config.cs  — handshake, stopEngine, setCustomGameProcess, config, getGpus
    //   IpcMessageHandler.Capture.cs — startCapture, stopCapture, getStatus, saveClip
    //   IpcMessageHandler.Audio.cs   — getAudioSessions, setAudioSessions
    //   IpcMessageHandler.Mic.cs     — getMicDevices, setMicDevice

    private async Task<IpcMessage?> OnIpcMessage(IpcMessage msg)
    {
        switch (msg.Action)
        {
            // Config messages
            case "handshake":
            case "setCustomGameProcess":
            case "config":
            case "getGpus":
                return HandleConfigMessages(msg, msg.Action);

            // Lifecycle — awaitado: erro real vira "error" em vez de fire-and-forget.
            case "stopEngine":
                return await HandleEngineLifecycleAsync(msg.Action);

            // Capture messages (saveClip needs async)
            case "startCapture":
            case "stopCapture":
            // getStatus: a app Electron nunca emite este comando. Só o harness de
            // soak externo o usa (ver AGENTS.md, secção SOAK) — mantido de propósito.
            case "getStatus":
            case "saveClip":
                return await HandleCaptureMessagesAsync(msg, msg.Action);

            // Audio messages
            case "getAudioSessions":
            case "setAudioSessions":
                return HandleAudioMessages(msg, msg.Action);

            // Mic messages
            case "getMicDevices":
            case "setMicDevice":
                return HandleMicMessages(msg, msg.Action);

            default:
                return new IpcMessage
                {
                    Action = "error",
                    Value = JsonSerializer.SerializeToElement(new { error = $"Unknown action: {msg.Action}" })
                };
        }
    }

}
