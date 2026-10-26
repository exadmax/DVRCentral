package main

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"syscall"
)

// Sistemas de arquivos de disco de verdade (ficam de fora tmpfs, proc, overlay...).
var deskDiskFS = map[string]bool{"ext2": true, "ext3": true, "ext4": true, "xfs": true, "btrfs": true, "vfat": true, "exfat": true,
	"ntfs": true, "ntfs3": true, "fuseblk": true, "f2fs": true, "zfs": true, "nfs": true, "nfs4": true, "cifs": true}

func deskDisks() []deskDisk {
	f, err := os.Open("/proc/mounts")
	if err != nil {
		return nil
	}
	defer f.Close()
	out, seen := []deskDisk{}, map[string]bool{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fl := strings.Fields(sc.Text())
		if len(fl) < 3 || !deskDiskFS[fl[2]] || seen[fl[0]] {
			continue
		}
		seen[fl[0]] = true
		mount := strings.ReplaceAll(fl[1], `\040`, " ") // o kernel escreve o espaço assim
		var st syscall.Statfs_t
		if syscall.Statfs(mount, &st) != nil {
			continue
		}
		out = append(out, deskDisk{Mount: mount, Device: fl[0], FS: fl[2], Total: st.Blocks * uint64(st.Bsize), Free: st.Bavail * uint64(st.Bsize)})
	}
	return out
}

func deskUptime() float64 {
	if f := strings.Fields(readLinuxFile("/proc/uptime")); len(f) > 0 {
		v, _ := strconv.ParseFloat(f[0], 64)
		return v
	}
	return 0
}

// deskPlatform devolve o nome da distribuição e o modelo da CPU.
func deskPlatform() (name, cpu string) {
	for _, line := range strings.Split(readLinuxFile("/etc/os-release"), "\n") {
		if v, ok := strings.CutPrefix(line, "PRETTY_NAME="); ok {
			name = strings.Trim(v, `"`)
		}
	}
	return name, firstLineValue(readLinuxFile("/proc/cpuinfo"), "model name")
}
