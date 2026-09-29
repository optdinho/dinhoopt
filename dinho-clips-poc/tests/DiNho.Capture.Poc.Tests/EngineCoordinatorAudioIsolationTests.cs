using DiNho.Capture.Poc;
using Xunit;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// "Só Jogo + Microfone" (per-process loopback) degrade para loopback COMPLETO em
/// vários caminhos. O aviso "Áudio do Sistema Inteiro" no status bar existe e está
/// traduzido nos 3 idiomas, mas em 2026-09-29 <c>_audioFallback</c> era atribuído
/// <c>false</c> nos 3 pontos e <c>true</c> em NENHUM — a UI nunca podia mostrar o aviso.
///
/// Estes testes travam a condição de acender. O ponto não é "degradação é ruim", é que
/// ela precisa ser VISÍVEL: quem pediu "só o jogo" e recebe o áudio do Discord, do
/// Spotify e das notificações precisa saber, senão a gravação estraga sem aviso nenhum.
/// </summary>
public class EngineCoordinatorAudioIsolationTests
{
    [Fact]
    public void FullSystemComFiltroPedido_AcendeAviso()
    {
        // O caso que importa: o jogo foi filtrado mas não há como isolar → tudo entra.
        Assert.True(EngineCoordinator.ShouldWarnFullSystemAudio(
            EngineCoordinator.AudioCaptureKind.FullLoopback, isolationRequested: true));
    }

    [Fact]
    public void FullSystemSemFiltroPedido_NaoAcendeAviso()
    {
        // Loopback completo é o MODO, não a degradação: "capturar áudio do sistema"
        // escolhido de propósito não tem nada de errado e não deve assustar o usuário.
        Assert.False(EngineCoordinator.ShouldWarnFullSystemAudio(
            EngineCoordinator.AudioCaptureKind.FullLoopback, isolationRequested: false));
    }

    [Fact]
    public void PerProcessComFiltroPedido_NaoAcendeAviso()
    {
        // Caminho saudável — é o que a função deve proteger de não regredir.
        Assert.False(EngineCoordinator.ShouldWarnFullSystemAudio(
            EngineCoordinator.AudioCaptureKind.PerProcess, isolationRequested: true));
    }

    [Fact]
    public void PerProcessSemFiltroPedido_NaoAcendeAviso()
    {
        Assert.False(EngineCoordinator.ShouldWarnFullSystemAudio(
            EngineCoordinator.AudioCaptureKind.PerProcess, isolationRequested: false));
    }

    [Theory]
    [InlineData(0, false)]        // lista vazia = áudio do sistema é o pedido
    [InlineData(1, true)]         // 1 app selecionado = isolamento pedido
    public void IsolamentoPedido_ListaVaziaNaoPede(int selectedCount, bool expected)
    {
        Assert.Equal(expected, EngineCoordinator.IsIsolationRequested(
            useExcludeMode: false, excludeProcessId: 0, selectedSessionCount: selectedCount));
    }

    [Fact]
    public void IsolamentoPedido_ExcludeModePede()
    {
        Assert.True(EngineCoordinator.IsIsolationRequested(
            useExcludeMode: true, excludeProcessId: 4321, selectedSessionCount: 0));
    }

    [Fact]
    public void IsolamentoPedido_ExcludeModeSemPidNaoPede()
    {
        // Modo exclude ligado mas sem PID é configuração inerte — não pode acender aviso.
        Assert.False(EngineCoordinator.IsIsolationRequested(
            useExcludeMode: true, excludeProcessId: 0, selectedSessionCount: 0));
    }
}
