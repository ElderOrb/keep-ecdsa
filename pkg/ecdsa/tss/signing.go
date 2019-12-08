package tss

import (
	"fmt"
	"math/big"

	"github.com/binance-chain/tss-lib/ecdsa/keygen"
	"github.com/binance-chain/tss-lib/ecdsa/signing"
	"github.com/binance-chain/tss-lib/tss"
	tssLib "github.com/binance-chain/tss-lib/tss"
	"github.com/keep-network/keep-tecdsa/pkg/ecdsa"
)

// InitializeSigning initializes a member to run a threshold multi-party signature
// calculation protocol. Signature will be calculated for provided digest.
//
// Network channel should support broadcast and unicast messages transport.
func (s *Signer) InitializeSigning(
	digest []byte,
	networkBridge *NetworkBridge,
) (*SigningSigner, error) {
	digestInt := new(big.Int).SetBytes(digest)

	errChan := make(chan error)

	party, endChan, err := s.initializeSigningParty(
		digestInt,
		networkBridge,
		errChan,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize signing party: [%v]", err)
	}

	return &SigningSigner{
		BaseMember:     s.BaseMember,
		networkBridge:  networkBridge,
		signingParty:   party,
		signingEndChan: endChan,
		signingErrChan: errChan,
	}, nil
}

// SigningSigner represents Signer who initialized signing stage and is ready to
// start signature calculation.
type SigningSigner struct {
	BaseMember

	networkBridge *NetworkBridge
	// Signing
	signingParty tssLib.Party
	// Channels where results of the signing protocol execution will be written to.
	signingEndChan <-chan signing.SignatureData // data from a successful execution
	signingErrChan <-chan error                 // errors emitted during the protocol execution
}

// Sign executes the protocol to calculate a signature. This function needs to be
// executed only after all members finished the initialization stage. As a result
// the calculated ECDSA signature will be returned.
func (s *SigningSigner) Sign() (*ecdsa.Signature, error) {
	defer s.networkBridge.close()

	if s.signingParty == nil {
		return nil, fmt.Errorf("failed to get initialized signing party")
	}

	if err := s.signingParty.Start(); err != nil {
		return nil, fmt.Errorf(
			"failed to start signing: [%v]",
			s.signingParty.WrapError(err),
		)
	}

	for {
		select {
		case signature := <-s.signingEndChan:
			ecdsaSignature := convertSignatureTSStoECDSA(signature)

			return &ecdsaSignature, nil
		case err := <-s.signingErrChan:
			return nil,
				fmt.Errorf(
					"failed to sign: [%v]",
					s.signingParty.WrapError(err),
				)
		}
	}
}

func (s *Signer) initializeSigningParty(
	digest *big.Int,
	tssParameters *tssParameters,
	keygenData keygen.LocalPartySaveData,
	networkBridge *NetworkBridge,
	errChan chan error,
) (tssLib.Party, <-chan signing.SignatureData, error) {
	outChan := make(chan tssLib.Message, len(tssParameters.sortedPartyIDs))
	endChan := make(chan signing.SignatureData)

	params := tss.NewParameters(
		tss.NewPeerContext(tssParameters.sortedPartyIDs),
		tssParameters.currentPartyID,
		len(tssParameters.sortedPartyIDs),
		tssParameters.threshold,
	)

	party := signing.NewLocalParty(digest, params, s.keygenData, outChan, endChan)

	if err := networkBridge.start(
		s.groupMembers,
		party,
		params,
		outChan,
		errChan,
	); err != nil {
		return nil, nil, fmt.Errorf("failed to connect bridge network: [%v]", err)
	}

	return party, endChan, nil
}

func convertSignatureTSStoECDSA(tssSignature signing.SignatureData) ecdsa.Signature {
	// `SignatureData` contains recovery ID as a byte slice. Only the first byte
	// is relevant and is converted to `int`.
	recoveryBytes := tssSignature.GetSignatureRecovery()
	recoveryInt := int(0)
	recoveryInt = (recoveryInt << 8) | int(recoveryBytes[0])

	return ecdsa.Signature{
		R:          new(big.Int).SetBytes(tssSignature.GetR()),
		S:          new(big.Int).SetBytes(tssSignature.GetS()),
		RecoveryID: recoveryInt,
	}
}
