package internal

import "github.com/keep-network/keep-tecdsa/pkg/net"

// TODO: The code here is copied from `keep-core/pkg/net/internal`. We should
// consider using the mentioned package as soon as we move the code to `keep-core`
// or export the package `internal`.

// BasicMessage returns a struct-based trivial implementation of the net.Message
// interface for use by packages that don't need any frills.
func BasicMessage(
	transportSenderID net.TransportIdentifier,
	payload interface{},
	messageType string,
	senderPublicKey []byte,
) net.Message {
	return &basicMessage{
		transportSenderID,
		payload,
		messageType,
		senderPublicKey,
	}
}

// basicMessage is a struct-based trivial implementation of the net.Message
// interface for use by packages that don't need any frills.
type basicMessage struct {
	transportSenderID net.TransportIdentifier
	payload           interface{}
	messageType       string
	senderPublicKey   []byte
}

func (m *basicMessage) TransportSenderID() net.TransportIdentifier {
	return m.transportSenderID
}

func (m *basicMessage) Payload() interface{} {
	return m.payload
}

func (m *basicMessage) Type() string {
	return m.messageType
}

func (m *basicMessage) SenderPublicKey() []byte {
	return m.senderPublicKey
}
