package config

import (
	"log"
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

// init memuat .env SEKALI, SEBELUM variabel package-level lain (mis. jwtSecret) diinisialisasi.
// Karena package config diimpor paling awal, ini cukup — tak perlu godotenv.Load() lagi di main().
func init() {
	godotenv.Load(".env")
}

func Env(key, defaultVal string) string {
	v := os.Getenv(key)
	if v == "" {
		return defaultVal
	}
	return v
}

func EnvRequired(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("ERROR: %s harus diset di .env", key)
	}
	return v
}

func EnvInt(key string, defaultVal int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return defaultVal
}
