package services

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"wa-assistant/backend/config"
	"wa-assistant/backend/database"
	"wa-assistant/backend/models"
)

//go:embed data/provinces.sql data/cities.sql data/districts.sql
var shippingSQL embed.FS

// ShippingResult = satu hasil ongkir dari RajaOngkir V2.
type ShippingResult struct {
	Courier  string `json:"courier"`
	Service  string `json:"service"`
	Cost     int    `json:"cost"`
	Estimate string `json:"estimate"`
}

// CheckShippingCost memanggil RajaOngkir V2 untuk cek ongkir (POST form-encoded).
func CheckShippingCost(origin, destination int, weight int, couriers []string) ([]ShippingResult, error) {
	apiKey := config.Env("RAJAONGKIR_API_KEY", "")
	if apiKey == "" {
		return nil, fmt.Errorf("RAJAONGKIR_API_KEY belum diset")
	}

	form := url.Values{}
	form.Set("origin", fmt.Sprintf("%d", origin))
	form.Set("destination", fmt.Sprintf("%d", destination))
	form.Set("weight", fmt.Sprintf("%d", weight))
	form.Set("courier", strings.Join(couriers, ":"))
	form.Set("price", "lowest")

	reqURL := config.Env("RAJAONGKIR_BASE_URL", "https://rajaongkir.komerce.id/api/v1") + "/calculate/domestic-cost"
	httpReq, _ := http.NewRequest("POST", reqURL, strings.NewReader(form.Encode()))
	httpReq.Header.Set("key", apiKey)
	httpReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("gagal panggil RajaOngkir: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var apiResp struct {
		Meta struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"meta"`
		Data []struct {
			Name    string `json:"name"`
			Code    string `json:"code"`
			Service string `json:"service"`
			Cost    int    `json:"cost"`
			Etd     string `json:"etd"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return nil, fmt.Errorf("gagal parse respon: %w", err)
	}
	if apiResp.Meta.Code != 200 {
		return nil, fmt.Errorf("RajaOngkir error: %s", apiResp.Meta.Message)
	}

	var results []ShippingResult
	for _, r := range apiResp.Data {
		results = append(results, ShippingResult{
			Courier:  strings.ToUpper(r.Code),
			Service:  r.Service,
			Cost:     r.Cost,
			Estimate: r.Etd,
		})
	}
	return results, nil
}

// ResolveCity mencari kota dari teks di DB lokal.
func ResolveCity(query string) []models.ShippingCity {
	query = strings.TrimSpace(strings.ToLower(query))
	if query == "" {
		return nil
	}
	var cities []models.ShippingCity
	database.DB.Where("search_text LIKE ?", "%"+query+"%").Order("city_name asc").Limit(5).Find(&cities)
	if len(cities) > 0 {
		return cities
	}
	// Fallback 1: coba per kata (untuk "jakarta utara" → ambil "jakarta")
	words := strings.Fields(query)
	if len(words) > 1 {
		for _, w := range words {
			if len(w) >= 3 {
				database.DB.Where("search_text LIKE ?", "%"+w+"%").Order("city_name asc").Limit(5).Find(&cities)
				if len(cities) > 0 {
					return cities
				}
			}
		}
	}
	// Fallback 2: coba 4 karakter pertama (toleransi typo: "surbaya" → "surb")
	if len(query) >= 4 {
		prefix := query[:4]
		database.DB.Where("search_text LIKE ?", "%"+prefix+"%").Order("city_name asc").Limit(5).Find(&cities)
		if len(cities) > 0 {
			return cities
		}
	}
	// Fallback: search via API langsung (kalau DB belum di-seed)
	return SearchCityViaAPI(query)
}

// SearchCityViaAPI mencari kota langsung ke RajaOngkir V2.
func SearchCityViaAPI(query string) []models.ShippingCity {
	apiKey := config.Env("RAJAONGKIR_API_KEY", "")
	if apiKey == "" {
		return nil
	}
	baseURL := config.Env("RAJAONGKIR_BASE_URL", "https://rajaongkir.komerce.id/api/v1")
	reqURL := fmt.Sprintf("%s/destination/domestic-destination?search=%s&limit=5", baseURL, url.QueryEscape(query))
	httpReq, _ := http.NewRequest("GET", reqURL, nil)
	httpReq.Header.Set("key", apiKey)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var apiResp struct {
		Data []struct {
			ID       int    `json:"id"`
			Label    string `json:"label"`
			CityName string `json:"city_name"`
			Province string `json:"province_name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return nil
	}
	var cities []models.ShippingCity
	for _, c := range apiResp.Data {
		cities = append(cities, models.ShippingCity{
			RajaOngkirID: c.ID,
			CityName:     c.CityName,
			Province:     c.Province,
			FullName:     c.Label,
			Type:         "",
		})
	}
	return cities
}

// SeedShippingCities = impor lengkap provinsi, kota, dan kecamatan dari SQL dump RajaOngkir V2.
// Idempoten: skip kalau data sudah ada.
func SeedShippingCities() {
	// 1. Seed provinsi
	seedShippingProvinces()
	// 2. Seed kota (perlu province_id dari step 1)
	seedShippingCitiesFromSQL()
	// 3. Seed kecamatan (perlu city_id dari step 2)
	seedShippingDistricts()
}

// seedShippingProvinces mengisi shipping_provinces dari provinces.sql.
func seedShippingProvinces() {
	var count int64
	database.DB.Model(&models.ShippingProvince{}).Count(&count)
	log.Printf("[Seed] Provinces count: %d", count)
	if count > 0 {
		return
	}
	data, err := shippingSQL.ReadFile("data/provinces.sql")
	if err != nil {
		log.Printf("[Seed] ERROR read provinces.sql: %v", err)
		return
	}
	log.Printf("[Seed] Provinces SQL loaded: %d bytes", len(data))
	records := parseSQLValues(string(data))
	if len(records) == 0 {
		return
	}
	for _, rec := range records {
		id, _ := strconv.Atoi(rec[0])
		database.DB.Create(&models.ShippingProvince{
			RajaOngkirID: id,
			Name:         rec[1],
		})
	}
}

// seedShippingCitiesFromSQL mengisi shipping_cities dari cities.sql, menautkan province_id via
// rajaongkir province ID → internal PK.
func seedShippingCitiesFromSQL() {
	var count int64
	database.DB.Model(&models.ShippingCity{}).Count(&count)
	if count > 100 {
		return
	}
	data, err := shippingSQL.ReadFile("data/cities.sql")
	if err != nil {
		return
	}
	records := parseSQLValues(string(data))
	if len(records) == 0 {
		return
	}
	// Build map: rajaongkir province ID → internal ShippingProvince.ID
	provMap := map[int]uint{}
	var provinces []models.ShippingProvince
	database.DB.Find(&provinces)
	for _, p := range provinces {
		provMap[p.RajaOngkirID] = p.ID
	}

	for _, rec := range records {
		id, _ := strconv.Atoi(rec[0])
		name := rec[1]
		provinceROID, _ := strconv.Atoi(rec[2])
		provinceInternalID := provMap[provinceROID]

		// Tentukan province name dan type
		provinceName := ""
		if p, ok := provinceByName(provMap, provinceROID); ok {
			provinceName = p
		}
		cityType := "Kota"
		fullName := name
		searchText := strings.ToLower(name + " " + provinceName)

		database.DB.Create(&models.ShippingCity{
			RajaOngkirID: id,
			ProvinceID:   provinceInternalID,
			Province:     provinceName,
			Type:         cityType,
			CityName:     name,
			FullName:     fullName,
			SearchText:   searchText,
		})
	}
}

// seedShippingDistricts mengisi shipping_districts dari districts.sql, menautkan city_id via
// rajaongkir city ID → internal ShippingCity.ID.
func seedShippingDistricts() {
	var count int64
	database.DB.Model(&models.ShippingDistrict{}).Count(&count)
	if count > 100 {
		return
	}
	data, err := shippingSQL.ReadFile("data/districts.sql")
	if err != nil {
		return
	}
	records := parseSQLValues(string(data))
	if len(records) == 0 {
		return
	}
	// Build map: rajaongkir city ID → internal ShippingCity.ID
	cityMap := map[int]uint{}
	var cities []models.ShippingCity
	database.DB.Find(&cities)
	for _, c := range cities {
		cityMap[c.RajaOngkirID] = c.ID
	}

	for _, rec := range records {
		id, _ := strconv.Atoi(rec[0])
		name := rec[1]
		cityROID, _ := strconv.Atoi(rec[2])
		cityInternalID := cityMap[cityROID]
		if cityInternalID == 0 {
			continue // skip district yang city-nya tidak ditemukan
		}
		database.DB.Create(&models.ShippingDistrict{
			RajaOngkirID: id,
			CityID:       cityInternalID,
			Name:         name,
		})
	}
}

// provinceByName returns province name by rajaongkir province ID from the loaded map.
func provinceByName(provMap map[int]uint, roID int) (string, bool) {
	// This requires reverse lookup — we need the province name from internal ID.
	// We already loaded all provinces; iterate to find.
	var p models.ShippingProvince
	if database.DB.Where("id = ?", provMap[roID]).First(&p).Error == nil {
		return p.Name, true
	}
	return "", false
}

// parseSQLValues mengekstrak array of array string dari VALUES di SQL INSERT.
// Format: VALUES (1, 'Name', ...), (2, 'Name2', ...);
// Returns [][]string — each row is a slice of field values.
func parseSQLValues(sql string) [][]string {
	// Cari bagian VALUES ... ;
	re := regexp.MustCompile(`(?s)VALUES\s+(.+);`)
	m := re.FindStringSubmatch(sql)
	if len(m) < 2 {
		return nil
	}
	valsStr := m[1]

	// Parse manual: iterasi karakter, track depth dan quote
	var result [][]string
	var currentRow []string
	var currentField strings.Builder
	inQuote := false
	depth := 0

	for i := 0; i < len(valsStr); i++ {
		ch := valsStr[i]

		if ch == '\'' {
			if inQuote && i+1 < len(valsStr) && valsStr[i+1] == '\'' {
				currentField.WriteByte('\'')
				i++
				continue
			}
			inQuote = !inQuote
			continue
		}

		if inQuote {
			currentField.WriteByte(ch)
			continue
		}

		switch ch {
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				// End of row
				currentRow = append(currentRow, strings.TrimSpace(currentField.String()))
				currentField.Reset()
				if len(currentRow) > 0 {
					result = append(result, currentRow)
				}
				currentRow = nil
			}
		case ',':
			if depth == 1 {
				// Field separator within a row
				currentRow = append(currentRow, strings.TrimSpace(currentField.String()))
				currentField.Reset()
			}
		case ' ', '	', '\r', '\n':
			// Skip whitespace outside quotes and outside fields
			continue
		default:
			currentField.WriteByte(ch)
		}
	}

	return result
}
