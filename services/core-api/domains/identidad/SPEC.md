# Dominio: Identidad

Fuente de verdad de quién es quién en el sistema: usuarios, empresas proveedoras y administradores. Ningún otro dominio guarda datos de perfil — solo referencian el `id`.

## Entidades que posee

- `Profile` (usuario, proveedor o admin)
- `Company` (empresa proveedora, con `status`: `pendiente` / `activo` / `suspendido`)
- `AdminRole` (`super_admin` / `soporte` / `finanzas`)

## Puertos de entrada (casos de uso)

```ts
interface IdentidadInboundPort {
  registrarUsuario(datos: RegistroUsuario): Promise<Profile>
  registrarEmpresa(datos: RegistroEmpresa): Promise<Company>       // queda en status 'pendiente'
  aprobarEmpresa(companyId: string, adminId: string): Promise<void>
  suspenderUsuario(profileId: string, adminId: string, motivo: string): Promise<void>
  suspenderEmpresa(companyId: string, adminId: string, motivo: string): Promise<void>
  asignarRolAdmin(profileId: string, rol: AdminRole): Promise<void>
}
```

## Puertos de salida (lo que el dominio necesita, sin saber cómo se implementa)

```ts
interface ProfileRepository {
  save(profile: Profile): Promise<void>
  findById(id: string): Promise<Profile | null>
}
interface CompanyRepository {
  save(company: Company): Promise<void>
  findById(id: string): Promise<Company | null>
}
interface AuthProvider {          // adaptador hacia Supabase Auth
  createAccount(email: string, password: string): Promise<string>
  deleteAccount(id: string): Promise<void>      // única eliminación física permitida (design.md D-1)
  findAccountByEmail(email: string): Promise<{ id: string } | null>
}
interface EventPublisher {
  publish(event: DomainEvent): Promise<void>
}
```

### Contrato de compensación de `AuthProvider` (design.md D-1)

`registrarUsuario` es Auth-first: primero `createAccount`, luego el `INSERT` en `profiles` (`id = uid` de Auth, `ON CONFLICT (id) DO NOTHING` — idempotente ante reintentos). `profiles.id` referencia `auth.users.id` con `ON DELETE RESTRICT`, lo que hace la compensación segura por construcción: el borrado del usuario de Auth solo puede tener éxito cuando **no** existe fila `profiles`.

- **Fallo determinista** del paso `profiles` (constraint, red, timeout de DB con respuesta clara de fallo): el adaptador **debe** llamar `deleteAccount(uid)` como compensación in-request. Gracias al `ON DELETE RESTRICT`, este borrado nunca puede tener éxito si ya existe una fila `profiles` para ese `uid` — protege contra compensar por error un registro que en realidad sí se completó.
- **Fallo ambiguo** del paso `createAccount` (timeout, 5xx): el adaptador **nunca** borra. Debe recuperarse hacia adelante llamando `findAccountByEmail(email)`: si no existe, el fallo fue limpio y reintentable; si existe (devuelve el `uid`), el dominio reintenta el `INSERT` de `profiles` con ese `uid` — la cuenta de Auth pudo haber quedado válida y borrarla sería destructivo.
- Si la compensación in-request (`deleteAccount`) falla, el `uid` queda huérfano: lo detecta `public.v_auth_orphans` (`supabase/migrations/20260803120110_01b_identidad_admin.sql`), service-role-only, ventana de gracia de 15 minutos. El job de reconciliación que consume esa vista se entrega en el cambio de Edge Functions, no en este — la política es siempre detectar y alertar, nunca auto-borrar (un huérfano de >15 min es estado histórico ambiguo).
- `deleteAccount` es la única eliminación física permitida en todo el sistema, y solo dentro de la ventana de la request que la originó.

## Eventos que publica

- `UsuarioRegistrado`
- `EmpresaRegistrada`
- `EmpresaAprobada` — habilita a `catalogo` y `refill-matching` a considerar esta empresa
- `EmpresaSuspendida` — obliga a `catalogo` a ocultar su catálogo y a `refill-matching` a excluirla del matching
- `UsuarioSuspendido`

## Eventos que consume

Ninguno. `Identidad` es la fuente de verdad, no reacciona a otros dominios.

## Al extraer como microservicio independiente

Es el mejor candidato para extraer primero: bajo acoplamiento (nadie escribe en sus tablas), y `AuthProvider` ya es un adaptador limpio hacia Supabase Auth. Su base de datos (`profiles`, `companies`, `admin_roles`) se separa sin fricción porque ningún otro dominio hace `JOIN` directo contra ella.
