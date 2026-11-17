package valnode

import (
	"fmt"

	"github.com/ethereum/go-ethereum/node"
)

const DefaultRPCRequestMaxBytes int64 = 3 * 1024 * 1024 * 1024

func (c *Config) ValidateRPCRequestLimit() error {
	if c == nil || c.RPCRequestMaxBytes <= 0 || c.RPCRequestMaxBytes > DefaultRPCRequestMaxBytes {
		return fmt.Errorf("validation RPC request limit must be positive and at most %d bytes", DefaultRPCRequestMaxBytes)
	}
	if uint64(c.RPCRequestMaxBytes) > uint64(^uint(0)>>1) {
		return fmt.Errorf("validation RPC request limit does not fit the host HTTP integer")
	}
	return nil
}

// Apply after generic HTTP/WS/auth settings and before node.New. Pinned Geth
// propagates these shared stack limits to its authenticated HTTP and WS paths.
// This function configures a value; it does not bind a listener or start a node.
func (c *Config) ApplyRPCRequestLimit(stack *node.Config) error {
	if stack == nil {
		return fmt.Errorf("validation RPC stack configuration required")
	}
	if err := c.ValidateRPCRequestLimit(); err != nil {
		return err
	}
	stack.HTTPBodyLimit = int(c.RPCRequestMaxBytes)
	stack.WSReadLimit = c.RPCRequestMaxBytes
	return nil
}
