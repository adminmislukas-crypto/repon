import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseFilters,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Actor } from '../../../../shared/auth/decorators/actor.decorator';
import { AdminRoles } from '../../../../shared/auth/decorators/roles.decorator';
import { Public } from '../../../../shared/auth/decorators/public.decorator';
import type { AuthenticatedActor } from '../../../../shared/auth/ports/actor.port';
import { AprobarEmpresaUseCase } from '../../ports-in/aprobar-empresa.use-case';
import { AsignarRolAdminUseCase } from '../../ports-in/asignar-rol-admin.use-case';
import { ReactivarEmpresaUseCase } from '../../ports-in/reactivar-empresa.use-case';
import { RegistrarEmpresaUseCase } from '../../ports-in/registrar-empresa.use-case';
import { RegistrarUsuarioUseCase } from '../../ports-in/registrar-usuario.use-case';
import { SuspenderEmpresaUseCase } from '../../ports-in/suspender-empresa.use-case';
import { SuspenderUsuarioUseCase } from '../../ports-in/suspender-usuario.use-case';
import { AsignarRolAdminDto } from './dto/asignar-rol-admin.dto';
import { CompanyResponseDto } from './dto/company-response.dto';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { ReactivacionDto } from './dto/reactivacion.dto';
import { RegistrarEmpresaDto } from './dto/registrar-empresa.dto';
import { RegistrarUsuarioDto } from './dto/registrar-usuario.dto';
import { SuspensionDto } from './dto/suspension.dto';
import { IdentidadExceptionFilter } from './identidad-exception.filter';
import {
  toCompanyResponseDto,
  toProfileResponseDto,
  toRegistrarEmpresaCommand,
  toRegistrarUsuarioCommand,
} from './identidad.mapper';

// design.md's "Superficie HTTP de identidad" table — 6 routes, one per
// use case built in Phase 4b. `core-api-auth-guard` spec, "Controller
// passes scalars, not the actor object": every admin route below reads
// `@Actor()` and forwards `actor.profileId` as a plain string, never the
// `AuthenticatedActor` object itself.
@ApiTags('identidad')
@ApiBearerAuth()
@Controller('identidad')
@UseFilters(IdentidadExceptionFilter)
export class IdentidadController {
  constructor(
    private readonly registrarUsuarioUseCase: RegistrarUsuarioUseCase,
    private readonly registrarEmpresaUseCase: RegistrarEmpresaUseCase,
    private readonly aprobarEmpresaUseCase: AprobarEmpresaUseCase,
    private readonly suspenderUsuarioUseCase: SuspenderUsuarioUseCase,
    private readonly suspenderEmpresaUseCase: SuspenderEmpresaUseCase,
    private readonly reactivarEmpresaUseCase: ReactivarEmpresaUseCase,
    private readonly asignarRolAdminUseCase: AsignarRolAdminUseCase,
  ) {}

  @Public()
  @Post('usuarios')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Auto-registro de usuario o proveedor (sin autenticación).' })
  @ApiCreatedResponse({ type: ProfileResponseDto })
  @ApiBadRequestResponse({ description: 'DTO inválido, o `role: provider` sin `companyId`.' })
  @ApiConflictResponse({ description: 'El correo ya está registrado.' })
  async registrarUsuario(@Body() dto: RegistrarUsuarioDto): Promise<ProfileResponseDto> {
    const profile = await this.registrarUsuarioUseCase.execute(toRegistrarUsuarioCommand(dto));
    return toProfileResponseDto(profile);
  }

  @Public()
  @Post('empresas')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Auto-registro de empresa proveedora, queda en status pendiente.' })
  @ApiCreatedResponse({ type: CompanyResponseDto })
  @ApiBadRequestResponse({ description: 'DTO inválido.' })
  async registrarEmpresa(@Body() dto: RegistrarEmpresaDto): Promise<CompanyResponseDto> {
    const company = await this.registrarEmpresaUseCase.execute(toRegistrarEmpresaCommand(dto));
    return toCompanyResponseDto(company);
  }

  @AdminRoles('super_admin', 'soporte')
  @Post('empresas/:id/aprobacion')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Aprueba una empresa pendiente (status -> activo).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  @ApiForbiddenResponse({ description: 'Actor no es admin, o su sub-rol no está permitido.' })
  @ApiNotFoundResponse({ description: 'La empresa no existe.' })
  async aprobarEmpresa(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() actor: AuthenticatedActor,
  ): Promise<void> {
    await this.aprobarEmpresaUseCase.execute(id, actor.profileId);
  }

  @AdminRoles('super_admin', 'soporte')
  @Post('empresas/:id/suspension')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Suspende una empresa (status -> suspendido).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  @ApiForbiddenResponse({ description: 'Actor no es admin, o su sub-rol no está permitido.' })
  @ApiNotFoundResponse({ description: 'La empresa no existe.' })
  async suspenderEmpresa(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspensionDto,
    @Actor() actor: AuthenticatedActor,
  ): Promise<void> {
    await this.suspenderEmpresaUseCase.execute(id, actor.profileId, dto.motivo);
  }

  // D-D (`backend-core-api-catalogo`): reverse edge of `suspenderEmpresa`
  // above, same admin sub-role matrix — `CompanyNotSuspendedError` (409) is
  // mapped by `IdentidadExceptionFilter` when the target isn't currently
  // `suspendido`.
  @AdminRoles('super_admin', 'soporte')
  @Post('empresas/:id/reactivacion')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reactiva una empresa suspendida (status -> activo).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  @ApiForbiddenResponse({ description: 'Actor no es admin, o su sub-rol no está permitido.' })
  @ApiNotFoundResponse({ description: 'La empresa no existe.' })
  @ApiConflictResponse({ description: 'La empresa no está suspendida.' })
  async reactivarEmpresa(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReactivacionDto,
    @Actor() actor: AuthenticatedActor,
  ): Promise<void> {
    await this.reactivarEmpresaUseCase.execute(id, actor.profileId, dto.motivo);
  }

  @AdminRoles('super_admin', 'soporte')
  @Post('usuarios/:id/suspension')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Suspende un usuario (status -> suspendido).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  @ApiForbiddenResponse({ description: 'Actor no es admin, o su sub-rol no está permitido.' })
  @ApiNotFoundResponse({ description: 'El perfil no existe.' })
  async suspenderUsuario(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspensionDto,
    @Actor() actor: AuthenticatedActor,
  ): Promise<void> {
    await this.suspenderUsuarioUseCase.execute(id, actor.profileId, dto.motivo);
  }

  // core-api-identidad spec, "Admin sub-role matrix per route": the only
  // route requiring `@AdminRoles('super_admin')` alone — granting a
  // sub-role is privilege escalation, `soporte`/`finanzas` MUST NOT do it.
  @AdminRoles('super_admin')
  @Put('usuarios/:id/rol-admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Asigna/reemplaza el sub-rol admin de un perfil (solo super_admin).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  @ApiForbiddenResponse({ description: 'Actor no es super_admin.' })
  async asignarRolAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AsignarRolAdminDto,
    @Actor() actor: AuthenticatedActor,
  ): Promise<void> {
    await this.asignarRolAdminUseCase.execute(id, dto.rol, actor.profileId);
  }
}
