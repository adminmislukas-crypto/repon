import type { CompanyRepository } from '../ports-out/company-repository.port';
import type { EventPublisher } from '../../../shared/event-bus/event-publisher.port';
import {
  RegistrarEmpresaUseCase,
  type RegistrarEmpresaCommand,
} from './registrar-empresa.use-case';

const command: RegistrarEmpresaCommand = {
  razonSocial: 'Proveedora SPA',
  rut: '76.123.456-7',
  giro: 'Distribución de agua',
};

describe('RegistrarEmpresaUseCase', () => {
  it('inserts exactly one company row in status pendiente and publishes EmpresaRegistrada', async () => {
    const companyRepository: jest.Mocked<CompanyRepository> = {
      save: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
    };
    const eventPublisher: jest.Mocked<EventPublisher> = { publish: jest.fn() };
    const useCase = new RegistrarEmpresaUseCase(companyRepository, eventPublisher);

    const company = await useCase.execute(command);

    expect(company.status).toBe('pendiente');
    expect(company.razonSocial).toBe(command.razonSocial);
    expect(company.rut).toBe(command.rut);
    expect(company.giro).toBe(command.giro);
    expect(typeof company.id).toBe('string');
    expect(company.id.length).toBeGreaterThan(0);

    expect(companyRepository.save).toHaveBeenCalledTimes(1);
    expect(companyRepository.save).toHaveBeenCalledWith(company);
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'empresa.registrada', companyId: company.id }),
    );
  });
});
