import { Body, Controller, HttpCode, HttpStatus, Post, UseFilters } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Actor } from '../../../../shared/auth/decorators/actor.decorator';
import type { AuthenticatedActor } from '../../../../shared/auth/ports/actor.port';
import { CrearSolicitudUseCase } from '../../ports-in/crear-solicitud.use-case';
import { RefillExceptionFilter } from './refill-exception.filter';
import { toRefillRequestResponseDto } from './refill.mapper';
import { CrearSolicitudDto } from './dto/crear-solicitud.dto';
import { RefillRequestResponseDto } from './dto/refill-request-response.dto';

/**
 * design.md D-E's "Superficie HTTP" table. Prefix `refill`, not
 * `refill-matching`: a hyphenated domain exposes its resource family, not
 * its internal name (design.md: "un dominio con nombre compuesto expone su
 * familia de recursos, no su nombre interno" — `pedidos-pagos` inherits
 * this rule; `openspec/changes/.../tasks.md` 4b.3 confirms the same,
 * pinned as load-bearing, not cosmetic). `mis-` codifies D13 in the URL
 * space, same as `mis-consumos`/`mi-catalogo`: no `:userId` path param
 * ever exists on any route this controller declares, so the only source
 * of the owner is `actor.profileId`.
 *
 * No `@Roles()` anywhere in this controller, and it's a decision, not an
 * omission: `refill_requests.user_id` references `profiles(id)` with no
 * role restriction, and its RLS policy is `user_id = auth.uid()` with no
 * role check — `@Roles('user')` would make the API stricter than the
 * database and would block a `provider` profile (who can also own a pet)
 * from requesting a refill. Same reasoning `ConsumoController` already
 * used for every one of its routes.
 *
 * This is this domain's FIRST controller — Phase 5b (`.../matching`) and
 * Phase 6b (`.../completar`) EXTEND this same class with more `@Post()`
 * handlers, they never create a second controller for this domain.
 */
@ApiTags('refill')
@ApiBearerAuth()
@Controller('refill')
@UseFilters(RefillExceptionFilter)
export class RefillController {
  constructor(private readonly crearSolicitudUseCase: CrearSolicitudUseCase) {}

  @Post('mis-solicitudes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Crea una solicitud de reposición propia del actor autenticado, nace en estado ' +
      "'abierta' (D13: sin userId en el body).",
  })
  @ApiCreatedResponse({ type: RefillRequestResponseDto })
  @ApiBadRequestResponse({
    description: 'DTO inválido (0 ítems, campos vacíos, precio negativo — 400 SOLICITUD_INVALIDA).',
  })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  async crearSolicitud(
    @Body() dto: CrearSolicitudDto,
    @Actor() actor: AuthenticatedActor,
  ): Promise<RefillRequestResponseDto> {
    const entity = await this.crearSolicitudUseCase.execute(
      actor.profileId,
      dto.items,
      dto.direccion,
      dto.comuna,
      dto.urgencia,
    );
    return toRefillRequestResponseDto(entity);
  }
}
