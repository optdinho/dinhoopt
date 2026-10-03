using System.Security.Principal;
using Xunit;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// xUnit 2.9.3 não tem <c>Assert.Skip</c>, e um <c>if (!admin) return;</c> contaria como
/// PASS — enganando o gate. Este atributo marca o teste como *skipped*, que é visível.
/// </summary>
public sealed class RequiresAdminFactAttribute : FactAttribute
{
    public RequiresAdminFactAttribute()
    {
        if (!IsAdministrator)
            Skip = "Requer processo de teste elevado (pipe CurrentUserOnly + integridade UIPI).";
    }

    public static bool IsAdministrator =>
        new WindowsPrincipal(WindowsIdentity.GetCurrent())
            .IsInRole(WindowsBuiltInRole.Administrator);
}
