package cursor

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
)

// Cursor represents a pagination cursor
type Cursor struct {
	Offset int64 `json:"offset"`
	Limit  int64 `json:"limit"`
}

// Encode encodes a cursor to a base64 string
func Encode(offset, limit int64) string {
	c := Cursor{
		Offset: offset,
		Limit:  limit,
	}
	data, err := json.Marshal(c)
	if err != nil {
		return ""
	}
	return base64.URLEncoding.EncodeToString(data)
}

// Decode decodes a cursor string to offset and limit
func Decode(cursor string) (offset, limit int64, err error) {
	if cursor == "" {
		return 0, 0, nil
	}
	
	data, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		return 0, 0, fmt.Errorf("invalid cursor: %w", err)
	}
	
	var c Cursor
	if err := json.Unmarshal(data, &c); err != nil {
		return 0, 0, fmt.Errorf("invalid cursor format: %w", err)
	}
	
	return c.Offset, c.Limit, nil
}

// NextCursor generates the next cursor for pagination
func NextCursor(currentOffset, limit int64, hasMore bool) string {
	if !hasMore {
		return ""
	}
	return Encode(currentOffset+limit, limit)
}

