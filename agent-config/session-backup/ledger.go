// Compiled only inside the exact Glass revision recorded by the snapshot.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/misty-step/glass/internal/portfolio"
	"github.com/misty-step/glass/internal/sources/taskledger"
	"github.com/misty-step/glass/internal/store"
)

func run() error {
	if len(os.Args) != 5 {
		return fmt.Errorf("usage: ledger STORE SESSIONS KAYLEE_LEDGER ITEM")
	}
	s, err := store.Open(os.Args[1])
	if err != nil {
		return err
	}
	defer s.Close()
	items, err := s.AllItems()
	if err != nil {
		return err
	}
	finished := false
	for _, item := range items {
		if item.ID == os.Args[4] && item.Status == "done" {
			finished = true
		}
	}
	if !finished {
		return fmt.Errorf("restored item is not finished: %s", os.Args[4])
	}
	ledgers, reading := taskledger.New(os.Args[2], os.Args[3]).Read(context.Background(), items)
	if !reading.OK() {
		return fmt.Errorf("restored ledger source failed: %+v", reading)
	}
	ledger, found := ledgers[os.Args[4]]
	if !found || len(ledger.Agents) == 0 {
		return fmt.Errorf("restored item has no attributed agents")
	}
	commitments := reading
	commitments.Source = "Commitments"
	view, err := portfolio.Item(portfolio.Inputs{
		Now: reading.At, Items: items, ItemsReading: commitments,
		PileItems: items, PileItemsReading: commitments,
		TaskLedgers: ledgers, TaskLedgersReading: reading,
	}, os.Args[4])
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(view.TaskRecords.Value)
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
