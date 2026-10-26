//go:build !linux && !windows

package main

func deskDisks() []deskDisk            { return []deskDisk{} }
func deskUptime() float64              { return 0 }
func deskPlatform() (name, cpu string) { return "", "" }
