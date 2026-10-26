//go:build windows

package main

import (
	"context"
	"os/exec"
)

// Só para desenvolvimento no Windows: em produção (Linux) vale desk_shell_unix.go. Não existe sudo aqui.
func buildShellCommand(ctx context.Context, command, cwd string, sudo bool) *exec.Cmd {
	tail := `; Write-Output ("` + "`n" + `__DESKEND__" + $LASTEXITCODE + "|" + (Get-Location).Path)`
	cmd := exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", command+tail)
	cmd.Dir = cwd
	return cmd
}
