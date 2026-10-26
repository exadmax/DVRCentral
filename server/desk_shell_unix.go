//go:build !windows

package main

import (
	"context"
	"os/exec"
	"syscall"
)

// buildShellCommand roda o comando num bash próprio (grupo de processos novo, para que cancelar mate também os filhos) e,
// ao final, imprime um marcador com o código de saída e a pasta atual: a tela usa isso para manter o `cd`.
// Com sudo, o bash inteiro roda como root. O sudo repassa o SIGTERM ao comando, que é o que o cancelamento usa nesse caso
// (um SIGKILL no sudo deixaria o filho root para trás, e o usuário do serviço não pode matá-lo).
func buildShellCommand(ctx context.Context, command, cwd string, sudo bool) *exec.Cmd {
	const script = `cd -- "$1" 2>/dev/null || cd ~; eval "$2"; __rc=$?; printf '\n__DESKEND__%s|%s\n' "$__rc" "$PWD"`
	var cmd *exec.Cmd
	if sudo {
		cmd = exec.CommandContext(ctx, "sudo", "-n", "bash", "-c", script, "_", cwd, command)
	} else {
		cmd = exec.CommandContext(ctx, "bash", "-c", script, "_", cwd, command)
	}
	cmd.Env = append(cmd.Environ(), "TERM=dumb", "PAGER=cat", "GIT_PAGER=cat", "SYSTEMD_PAGER=")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if sudo {
			return syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
	return cmd
}
