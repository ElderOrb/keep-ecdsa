// Package tss contains implementation of Threshold Multi-Party ECDSA Signature
// Scheme. This package uses [tss-lib] protocol implementation based on [GG19].
//
// [tss-lib]: https://github.com/binance-chain/tss-lib.
// [GG19]: Fast Multiparty Threshold ECDSA with Fast Trustless Setup, Rosario
// Gennaro and Steven Goldfeder, 2019, https://eprint.iacr.org/2019/114.pdf.
package tss

import (
	"fmt"
	"sync"

	"github.com/binance-chain/tss-lib/ecdsa/keygen"
	"github.com/ipfs/go-log"
	"github.com/keep-network/keep-tecdsa/pkg/ecdsa"
	"github.com/keep-network/keep-tecdsa/pkg/net"
)

var logger = log.Logger("keep-tss")

// TODO: Temporary synchronization mechanism just for local signer implementation.
var (
	KeyGenSync  sync.WaitGroup
	SigningSync sync.WaitGroup
)

// GenerateThresholdSigner executes a threshold multi-party key generation protocol.
//
// It expects unique identifiers of the current member as well as identifiers of
// all members of the signing group. Group ID should be unique for each concurrent
// execution.
//
// Dishonest threshold `t` defines a maximum number of signers controlled by the
// adversary such that the adversary still cannot produce a signature. Any subset
// of `t + 1` players can jointly sign, but any smaller subset cannot.
//
// TSS protocol requires pre-parameters such as safe primes to be generated for
// execution. The parameters should be generated prior to running this function.
// If not provided they will be generated.
//
// As a result a signer will be returned or an error, if key generation failed.
func GenerateThresholdSigner(
	groupID string,
	memberID MemberID,
	groupMemberIDs []MemberID,
	dishonestThreshold uint,
	networkProvider net.Provider,
	tssPreParams *keygen.LocalPreParams,
) (*ThresholdSigner, error) {
	if len(groupMemberIDs) < 1 {
		return nil, fmt.Errorf("group should have at least one member")
	}

	if len(groupMemberIDs) <= int(dishonestThreshold) {
		return nil, fmt.Errorf(
			"group size [%d], should be greater than dishonest threshold [%d]",
			len(groupMemberIDs),
			dishonestThreshold,
		)
	}

	group := &groupInfo{
		groupID:            groupID,
		memberID:           memberID,
		groupMemberIDs:     groupMemberIDs,
		dishonestThreshold: int(dishonestThreshold),
	}

	if tssPreParams == nil {
		logger.Info("tss pre-params were not provided, generating them now")
		params, err := GenerateTSSPreParams()
		if err != nil {
			return nil, err
		}
		tssPreParams = params
	}

	netBridge := newNetworkBridge(networkProvider)

	keyGenSigner, err := initializeKeyGeneration(
		group,
		tssPreParams,
		netBridge,
	)
	if err != nil {
		return nil, err
	}
	logger.Infof("[party:%s]: initialized key generation", keyGenSigner.keygenParty.PartyID())

	// TODO: Sync
	KeyGenSync.Done()
	KeyGenSync.Wait()

	logger.Infof("[party:%s]: starting key generation", keyGenSigner.keygenParty.PartyID())

	signer, err := keyGenSigner.generateKey()
	if err != nil {
		logger.Errorf("err")
		return nil, err
	}
	logger.Infof("[party:%s]: completed key generation", keyGenSigner.keygenParty.PartyID())

	return signer, nil
}

// CalculateSignature executes a threshold multi-party signature calculation
// protocol for the given digest. As a result the calculated ECDSA signature will
// be returned or an error, if the signature generation failed.
func (s *ThresholdSigner) CalculateSignature(
	digest []byte,
	networkProvider net.Provider,
) (*ecdsa.Signature, error) {
	netBridge := newNetworkBridge(networkProvider)

	signingSigner, err := s.initializeSigning(digest[:], netBridge)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize signer: [%v]", err)
	}

	// TODO: Sync
	SigningSync.Done()
	SigningSync.Wait()

	signature, err := signingSigner.sign()
	if err != nil {
		return nil, fmt.Errorf("failed to start signing: [%v]", err)
	}

	return signature, err
}
