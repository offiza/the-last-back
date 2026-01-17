# Matchmaking System

## Overview

The matchmaking system automatically creates matches and assigns players to them based on room type (Stars or TON).

## How It Works

1. **Player joins** via WebSocket with `match:join` event
2. **Matchmaker** searches for existing waiting match with same room type
3. If found and not full → **adds player** to existing match
4. If not found or full → **creates new match**
5. When match reaches 10 players → **automatically starts**

## WebSocket Events

### Client → Server

#### `match:join`
Join a room/match.

```typescript
socket.emit('match:join', {
  roomType: 'stars' | 'ton',
  initData?: string,  // Telegram WebApp initData
  userId?: string,     // Fallback for development
  userName?: string    // Fallback for development
});
```

#### `match:leave`
Leave current match.

```typescript
socket.emit('match:leave');
```

#### `match:status`
Get current match status.

```typescript
socket.emit('match:status', {
  matchId: string
});
```

### Server → Client

#### `match:joined`
Successfully joined a match.

```typescript
{
  match: Match,
  playerId: string
}
```

#### `match:playerJoined`
Another player joined your match.

```typescript
{
  match: Match,
  newPlayer: Player
}
```

#### `match:started`
Match is full and started.

```typescript
{
  match: Match
}
```

#### `match:playerLeft`
A player left the match.

```typescript
{
  match: Match,
  playerId: string
}
```

#### `error`
Error occurred.

```typescript
{
  message: string
}
```

## API Endpoints

### GET `/api/rooms`
Get list of available room presets.

**Response:**
```json
{
  "rooms": [
    {
      "id": "stars_25",
      "type": "stars",
      "entryFee": 25,
      "maxPlayers": 10,
      "rounds": 3,
      "platformFee": 10
    },
    {
      "id": "ton_0_1",
      "type": "ton",
      "entryFee": 0.1,
      "maxPlayers": 10,
      "rounds": 3,
      "platformFee": 10
    }
  ]
}
```

## Match States

- `waiting` - Waiting for players (0-9 players)
- `playing` - Game in progress (10 players)
- `finished` - Game completed

## Player Identification

### Production (Telegram)
Uses Telegram user ID from `initData`:
- Extracted from Telegram WebApp `initData`
- Validated using HMAC-SHA256
- Unique per Telegram user

### Development
Uses fallback:
- `userId` from client (or socket.id)
- `userName` from client (or "Player")

## Example Flow

```
1. Player A connects → match:join (stars)
   → Creates Match 1 (1/10 players)

2. Player B connects → match:join (stars)
   → Joins Match 1 (2/10 players)

3. Players C-I connect → match:join (stars)
   → Join Match 1 (9/10 players)

4. Player J connects → match:join (stars)
   → Joins Match 1 (10/10 players)
   → match:started event sent to all

5. Player K connects → match:join (stars)
   → Creates Match 2 (1/10 players)
```

## Storage

Currently uses **in-memory storage** (Map):
- `activeMatches` - Active matches
- `playerToMatch` - Player → Match mapping
- `socketToPlayer` - Socket → Player mapping

**Note:** For production, consider:
- Redis for distributed matchmaking
- Database for match history
- Persistent storage for player data

