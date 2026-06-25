package services

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"os"
	"strings"

	"google.golang.org/api/option"
	"google.golang.org/api/sheets/v4"
)

// ParseSpreadsheetID mengambil ID spreadsheet dari URL Google Sheets.
// Input: "https://docs.google.com/spreadsheets/d/xxx/edit"
// Output: "xxx"
func ParseSpreadsheetID(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	parts := strings.Split(u.Path, "/")
	for i, p := range parts {
		if p == "d" && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return ""
}

var sheetsClient *sheets.Service

// InitSheets inisialisasi Google Sheets client dari service account JSON.
// Dipanggil saat startup jika GOOGLE_APPLICATION_CREDENTIALS diset.
func InitSheets() {
	credFile := os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")
	if credFile == "" {
		log.Println("[sheets] GOOGLE_APPLICATION_CREDENTIALS tidak diset, integrasi Google Sheets dinonaktifkan")
		return
	}
	ctx := context.Background()
	srv, err := sheets.NewService(ctx, option.WithCredentialsFile(credFile))
	if err != nil {
		log.Printf("[sheets] Gagal inisialisasi: %v", err)
		return
	}
	sheetsClient = srv
	log.Println("[sheets] Google Sheets client siap")
}

// AppendRow menambahkan satu baris data ke sheet.
// spreadsheetID: ID dari URL, sheetName: nama tab, values: slice string per kolom.
func AppendRow(spreadsheetID, sheetName string, values []string) error {
	if sheetsClient == nil {
		return fmt.Errorf("sheets client belum diinisialisasi")
	}
	range_ := sheetName + "!A:Z"
	_, err := sheetsClient.Spreadsheets.Values.Append(spreadsheetID, range_, &sheets.ValueRange{
		Values: [][]interface{}{toInterfaceSlice(values)},
	}).ValueInputOption("RAW").Context(context.Background()).Do()
	return err
}

func toInterfaceSlice(vals []string) []interface{} {
	out := make([]interface{}, len(vals))
	for i, v := range vals {
		out[i] = v
	}
	return out
}

// TestConnection mencoba membaca 1 baris dari sheet untuk verifikasi akses.
func TestConnection(spreadsheetID, sheetName string) error {
	if sheetsClient == nil {
		return fmt.Errorf("sheets client belum diinisialisasi")
	}
	range_ := sheetName + "!A1:A1"
	_, err := sheetsClient.Spreadsheets.Values.Get(spreadsheetID, range_).Context(context.Background()).Do()
	return err
}
