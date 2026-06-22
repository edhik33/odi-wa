package services

import (
	"context"
	"fmt"
	"sync"

	"go.mau.fi/whatsmeow"
	waProto "go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
	waLog "go.mau.fi/whatsmeow/util/log"

	_ "github.com/mattn/go-sqlite3"
)

type waInstance struct {
	mu     sync.Mutex
	client *whatsmeow.Client
	qrCode string
	status string
	number string
}

var instances = make(map[uint]*waInstance)
var globalMu sync.Mutex

func InitWA(_ string) {}

func WA(agentID uint) *waInstance {
	globalMu.Lock()
	defer globalMu.Unlock()
	if w, ok := instances[agentID]; ok {
		return w
	}
	w := &waInstance{status: "disconnected"}
	instances[agentID] = w
	return w
}

func FirstDeviceJID() string { return "" }

func (w *waInstance) Connect(deviceJID string) (string, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	dbPath := fmt.Sprintf("data/wa-session-%s.db", deviceJID)
	if deviceJID == "" {
		dbPath = "data/wa-session.db"
	}

	container, err := sqlstore.New(context.Background(), "sqlite3", "file:"+dbPath+"?_foreign_keys=on", waLog.Noop)
	if err != nil {
		return "", fmt.Errorf("gagal buat store: %w", err)
	}

	device, err := container.GetFirstDevice(context.Background())
	if err != nil {
		return "", fmt.Errorf("gagal ambil device: %w", err)
	}

	w.client = whatsmeow.NewClient(device, waLog.Noop)

	if w.client.Store.ID == nil {
		qrChan, _ := w.client.GetQRChannel(context.Background())
		err := w.client.Connect()
		if err != nil {
			return "", fmt.Errorf("gagal connect: %w", err)
		}
		go func() {
			for evt := range qrChan {
				switch evt.Event {
				case "code":
					w.mu.Lock()
					w.qrCode = evt.Code
					w.status = "qr"
					w.mu.Unlock()
				default:
					w.mu.Lock()
					w.qrCode = ""
					w.status = "connected"
					w.mu.Unlock()
					return
				}
			}
		}()
		w.status = "qr"
		return "qr", nil
	}

	err = w.client.Connect()
	if err != nil {
		return "", fmt.Errorf("gagal connect: %w", err)
	}
	w.status = "connected"
	return "connected", nil
}

func (w *waInstance) GetQR() string {
	w.mu.Lock(); defer w.mu.Unlock()
	return w.qrCode
}

func (w *waInstance) GetStatus() string {
	w.mu.Lock(); defer w.mu.Unlock()
	return w.status
}

func (w *waInstance) GetInfo() (string, string) {
	w.mu.Lock(); defer w.mu.Unlock()
	return w.number, w.status
}

func (w *waInstance) SendMessage(to types.JID, message string) error {
	w.mu.Lock(); defer w.mu.Unlock()
	if w.client == nil {
		return fmt.Errorf("tidak terhubung")
	}
	_, err := w.client.SendMessage(context.Background(), to, &waProto.Message{
		Conversation: proto.String(message),
	})
	return err
}

func (w *waInstance) OnMessage(handler func(sender types.JID, msg string)) {
	w.client.AddEventHandler(func(evt interface{}) {
		switch v := evt.(type) {
		case *events.Message:
			if !v.Info.IsGroup {
				msg := v.Message.GetConversation()
				if msg != "" {
					handler(v.Info.Sender, msg)
				}
			}
		}
	})
}

func SetHandlers(onMsg func(uint, types.JID, string), onLink func(uint, string, string)) {}
