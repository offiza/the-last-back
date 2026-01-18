# Тестирование

Проект использует [Vitest](https://vitest.dev/) для тестирования.

## Установка

```bash
cd the-last-back
pnpm add -D vitest @vitest/ui
```

## Запуск тестов

```bash
# Запустить тесты в watch режиме
pnpm test

# Запустить тесты один раз
pnpm test:run

# Запустить тесты с UI
pnpm test:ui

# Запустить тесты с покрытием
pnpm test:coverage
```

## Структура тестов

Тесты находятся в директории `src/**/__tests__/` рядом с тестируемым кодом:

```
src/
  services/
    __tests__/
      JoinIntentService.test.ts      # Тесты для JoinIntentService
      WalletService.test.ts           # Тесты для WalletService
      EscrowService.test.ts           # Тесты для EscrowService
      refund-integration.test.ts      # Интеграционные тесты для рефандов
```

## Покрытие тестами

### JoinIntentService
- ✅ Создание join intent
- ✅ Валидация кошелька при создании
- ✅ Получение PAID intent для входа в комнату
- ✅ Создание рефанда при выходе игрока
- ✅ Отметка intent как PAID
- ✅ Обработка существующих рефандов

### WalletService
- ✅ Генерация proof payload
- ✅ Получение кошелька по playerId
- ✅ Проверка наличия кошелька

### EscrowService
- ✅ Конвертация TON ↔ nanotons
- ✅ Валидация суммы депозита
- ✅ Валидация timestamp депозита
- ✅ Получение адреса escrow контракта

### Интеграционные тесты
- ✅ Создание рефанда при выходе из комнаты
- ✅ Обработка дублирующихся рефандов
- ✅ Рефанды по разным причинам (player_left, match_cancelled)

## Mocking

Тесты используют моки для:
- Prisma Client (база данных)
- WalletService
- Внешние зависимости (TON Connect SDK)

## Запуск конкретного теста

```bash
# Запустить конкретный файл
pnpm test JoinIntentService

# Запустить тест по названию
pnpm test -t "should create intent"
```

