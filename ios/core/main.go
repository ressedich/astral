package main

/*
#include <stdlib.h>
*/
import "C"

import (
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"

	"github.com/xtls/xray-core/core"
	"github.com/xtls/xray-core/transport/internet"

	_ "github.com/xtls/xray-core/main/distro/all"
	_ "github.com/xtls/xray-core/main/json"
)

const (
	ipBoundIf   = 25
	ipv6BoundIf = 125
)

var (
	mu         sync.Mutex
	instance   *core.Instance
	ifaceName  atomic.Value
	boundMu    sync.Mutex
	boundName  string
	boundIndex int
	errBuf     [768]C.char
)

func init() {
	_ = internet.RegisterDialerController(bindOutbound)
}

func currentIface() string {
	name, _ := ifaceName.Load().(string)
	return name
}

func bindIndex() (int, error) {
	name := currentIface()
	if name == "" {
		return 0, nil
	}
	boundMu.Lock()
	defer boundMu.Unlock()
	if name == boundName && boundIndex > 0 {
		return boundIndex, nil
	}
	link, err := net.InterfaceByName(name)
	if err != nil {
		return 0, err
	}
	boundName = name
	boundIndex = link.Index
	return link.Index, nil
}

func bindOutbound(network, address string, raw syscall.RawConn) error {
	host, _, splitErr := net.SplitHostPort(address)
	if splitErr == nil {
		if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
			return nil
		}
	}
	index, err := bindIndex()
	if err != nil || index == 0 {
		return err
	}
	var sockErr error
	controlErr := raw.Control(func(fd uintptr) {
		if strings.HasSuffix(network, "6") {
			sockErr = syscall.SetsockoptInt(int(fd), syscall.IPPROTO_IPV6, ipv6BoundIf, index)
			return
		}
		sockErr = syscall.SetsockoptInt(int(fd), syscall.IPPROTO_IP, ipBoundIf, index)
	})
	if controlErr != nil {
		return controlErr
	}
	return sockErr
}

func stash(message string) *C.char {
	text := message
	if len(text) > 700 {
		text = text[:700]
	}
	for i := range errBuf {
		errBuf[i] = 0
	}
	for i, b := range []byte(text) {
		errBuf[i] = C.char(b)
	}
	return &errBuf[0]
}

//export AstralSetInterface
func AstralSetInterface(name *C.char) {
	if name == nil {
		ifaceName.Store("")
		return
	}
	ifaceName.Store(C.GoString(name))
}

//export AstralStart
func AstralStart(config *C.char) *C.char {
	if config == nil {
		return stash("Пустой конфиг")
	}
	mu.Lock()
	defer mu.Unlock()
	if instance != nil {
		_ = instance.Close()
		instance = nil
	}
	started, err := core.StartInstance("json", []byte(C.GoString(config)))
	if err != nil {
		return stash(err.Error())
	}
	instance = started
	return nil
}

//export AstralStop
func AstralStop() {
	mu.Lock()
	defer mu.Unlock()
	if instance != nil {
		_ = instance.Close()
		instance = nil
	}
}

func main() {}
