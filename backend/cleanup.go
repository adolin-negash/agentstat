package main

import (
	"database/sql"
	"errors"
	"io"
	"log"
)

func closeAndLogError(closer io.Closer) {
	if err := closer.Close(); err != nil {
		log.Printf("close resource: %v", err)
	}
}

func rollbackIfOpen(tx *sql.Tx) {
	if err := tx.Rollback(); err != nil && !errors.Is(err, sql.ErrTxDone) {
		log.Printf("rollback transaction: %v", err)
	}
}
