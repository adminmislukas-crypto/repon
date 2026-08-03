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
}
interface EventPublisher {
  publish(event: DomainEvent): Promise<void>
}
```

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
