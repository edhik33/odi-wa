package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"wa-assistant/backend/config"
	"wa-assistant/backend/database"
	"wa-assistant/backend/models"
)

// ShippingResult = satu hasil ongkir dari RajaOngkir.
type ShippingResult struct {
	Courier  string `json:"courier"`
	Service  string `json:"service"`
	Cost     int    `json:"cost"`
	Estimate string `json:"estimate"` // estimasi hari
}

// CheckShippingCost memanggil RajaOngkir untuk cek ongkir.
func CheckShippingCost(origin, destination int, weight int, couriers []string) ([]ShippingResult, error) {
	apiKey := config.Env("RAJAONGKIR_API_KEY", "")
	if apiKey == "" {
		return nil, fmt.Errorf("RAJAONGKIR_API_KEY belum diset")
	}
	baseURL := config.Env("RAJAONGKIR_BASE_URL", "https://rajaongkir.komerce.id/api/v1")

	reqURL, _ := url.Parse(baseURL + "/calculate/domestic-cost")
	q := reqURL.Query()
	q.Set("origin", fmt.Sprintf("%d", origin))
	q.Set("destination", fmt.Sprintf("%d", destination))
	q.Set("weight", fmt.Sprintf("%d", weight))
	q.Set("courier", strings.Join(couriers, ":"))
	q.Set("price", "lowest")
	reqURL.RawQuery = q.Encode()

	httpReq, _ := http.NewRequest("GET", reqURL.String(), nil)
	httpReq.Header.Set("key", apiKey)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("gagal panggil RajaOngkir: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var apiResp struct {
		Data struct {
			Results []struct {
				Courier string `json:"courier"`
				Costs   []struct {
					Service string `json:"service"`
					Cost    int    `json:"cost"`
					Etd     string `json:"etd"`
				} `json:"costs"`
			} `json:"results"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return nil, fmt.Errorf("gagal parse respon RajaOngkir: %w", err)
	}

	var results []ShippingResult
	for _, r := range apiResp.Data.Results {
		for _, c := range r.Costs {
			results = append(results, ShippingResult{
				Courier:  strings.ToUpper(r.Courier),
				Service:  c.Service,
				Cost:     c.Cost,
				Estimate: c.Etd,
			})
		}
	}
	return results, nil
}

// ResolveCity mencari kota dari teks (keyword, substring).
// Return: slice of ShippingCity yang cocok, atau empty.
func ResolveCity(query string) []models.ShippingCity {
	query = strings.TrimSpace(strings.ToLower(query))
	if query == "" {
		return nil
	}
	var cities []models.ShippingCity
	database.DB.Where("search_text LIKE ?", "%"+query+"%").Order("city_name asc").Limit(5).Find(&cities)
	return cities
}

// SearchCities = endpoint untuk UI: cari kota asal.
func SearchCities(query string) []models.ShippingCity {
	return ResolveCity(query)
}

// SeedShippingCities = impor daftar kota dari RajaOngkir sekali, simpan ke DB lokal.
// Panggil via admin trigger atau startup seed.
func SeedShippingCities() {
	var count int64
	database.DB.Model(&models.ShippingCity{}).Count(&count)
	if count > 100 {
		return // sudah di-seed, skip
	}

	apiKey := config.Env("RAJAONGKIR_API_KEY", "")
	if apiKey == "" {
		return
	}
	baseURL := config.Env("RAJAONGKIR_BASE_URL", "https://rajaongkir.komerce.id/api/v1")

	reqURL, _ := url.Parse(baseURL + "/locations/cities")
	httpReq, _ := http.NewRequest("GET", reqURL.String(), nil)
	httpReq.Header.Set("key", apiKey)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var apiResp struct {
		Data []struct {
			ID       int    `json:"id"`
			Province string `json:"province"`
			Type     string `json:"type"`
			CityName string `json:"city_name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return
	}

	var cities []models.ShippingCity
	for _, c := range apiResp.Data {
		fullName := c.Type + " " + c.CityName
		searchText := strings.ToLower(fullName + " " + c.Province)
		cities = append(cities, models.ShippingCity{
			RajaOngkirID: c.ID,
			Province:     c.Province,
			Type:         c.Type,
			CityName:     c.CityName,
			FullName:     fullName,
			SearchText:   searchText,
		})
	}
	database.DB.CreateInBatches(cities, 200)
}
