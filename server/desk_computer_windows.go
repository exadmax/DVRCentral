package main

import (
	"syscall"
	"unsafe"
)

var (
	deskKernel32     = syscall.NewLazyDLL("kernel32.dll")
	procDiskFreeEx   = deskKernel32.NewProc("GetDiskFreeSpaceExW")
	procGetTickCount = deskKernel32.NewProc("GetTickCount64")
)

func deskDisks() []deskDisk {
	out := []deskDisk{}
	for c := 'A'; c <= 'Z'; c++ {
		root := string(c) + ":\\"
		p, err := syscall.UTF16PtrFromString(root)
		if err != nil {
			continue
		}
		var free, total, totalFree uint64
		r, _, _ := procDiskFreeEx.Call(uintptr(unsafe.Pointer(p)), uintptr(unsafe.Pointer(&free)), uintptr(unsafe.Pointer(&total)), uintptr(unsafe.Pointer(&totalFree)))
		if r != 0 && total > 0 {
			out = append(out, deskDisk{Mount: "/" + string(c) + ":", Total: total, Free: free})
		}
	}
	return out
}

func deskUptime() float64 {
	ms, _, _ := procGetTickCount.Call()
	return float64(ms) / 1000
}

func deskPlatform() (name, cpu string) { return "Windows", "" }
