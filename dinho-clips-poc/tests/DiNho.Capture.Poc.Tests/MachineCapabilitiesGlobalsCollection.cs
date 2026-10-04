using Xunit;

namespace DiNho.Capture.Poc.Tests;

// MachineCapabilities expoe a deteccao como DELEGADOS ESTATICOS mutaveis
// (DetectAdapters, GetCpuCores, GetTotalRamBytes, ...) usados como seam de teste.
//
// EngineCoordinatorCalibrationTests e MachineCapabilitiesTests sobrescrevem-nos e
// restore no Dispose, mas em colecoes diferentes o xUnit corre as duas EM PARALELO.
// Uma leitura que apanha um delegate ja restaurado (ou o inverso) mede a MAQUINA REAL
// em vez do cenario sintetico, e a assercao falha de forma intermitente
// (falha observada em EngineCoordinatorCalibrationTests.TryApply_StrongMachine_NoBehavioralChange,
// que espera tier Strong / p5 e falha quando le o hardware da maquina).
//
// O teste novo CfrPacerSimulationTests nao mexe em nada disto; apenas altera a ordem de
// escalonamento das threads e torna a corrida visivel. A correcao e isolar os globais.
//
// DisableParallelization mantem esta colecao sequencial E isolada das demais colecoes.
[CollectionDefinition("MachineCapabilitiesGlobals", DisableParallelization = true)]
public sealed class MachineCapabilitiesGlobalsCollection
{
}