# Dominio: Consumo

Configuración de dosis y porciones (persona o mascota), registro de tomas, cálculo de stock restante y disparo de alertas o refills automáticos.

## Entidades que posee

- `Pet`
- `UserConsumption` (dosis, frecuencia, horarios, stock actual — `ownerType`: `self` | `pet`)
- `ConsumptionLog` (cada toma/porción registrada, usada para adherencia y racha)

## Puertos de entrada (casos de uso)

```ts
interface ConsumoInboundPort {
  registrarMascota(userId: string, datos: NuevaMascota): Promise<Pet>
  configurarConsumo(userId: string, config: NuevoConsumo): Promise<UserConsumption>
  marcarDosisTomada(consumptionId: string, timestamp: Date): Promise<void>
  calcularDiasRestantes(consumptionId: string): Promise<number>   // usado también por el cron
}
```

## Puertos de salida

```ts
interface ConsumptionRepository {
  save(item: UserConsumption): Promise<void>
  findDueForCheck(): Promise<UserConsumption[]>   // usado por el cron diario
}
interface ConsumptionLogRepository {
  append(log: ConsumptionLog): Promise<void>
  adherenciaUltimos7Dias(consumptionId: string): Promise<number>
}
interface NotificationPort {
  sendPush(userId: string, mensaje: string): Promise<void>
}
interface EventPublisher {
  publish(event: DomainEvent): Promise<void>
}
```

## Job programado (cron diario, dentro del mismo dominio)

`calcularDiasRestantes` corre para cada `UserConsumption` activo. Si el resultado cae bajo el umbral configurado, dispara `StockBajoDetectado`. Si además el usuario activó "auto-crear refill", dispara `RefillAutoSolicitado`.

## Eventos que publica

- `StockBajoDetectado`
- `RefillAutoSolicitado` — lo escucha `refill-matching` para crear la solicitud sin intervención del usuario
- `DosisRegistrada`

## Eventos que consume

Ninguno. `Consumo` reacciona a su propio cron, no a eventos de otros dominios.

## Al extraer como microservicio independiente

Es el dominio con el job programado más pesado (recorre todos los `UserConsumption` activos a diario). Si el volumen de usuarios crece, es el primer candidato a separar solo para no competir por recursos con las peticiones síncronas de los demás dominios durante la ventana del cron.
