import { ScreenStub } from '@/components/ScreenStub';
import { AuthWiringProbe, REPON_AUTH_PACKAGE_ID } from '@repon/auth';

/** SPEC.md `s-perfil` — datos personales, dirección, método de pago, vista
 *  previa del historial. */
export default function PerfilScreen() {
  return (
    <>
      <ScreenStub
        title="Perfil"
        description={`Datos personales, dirección, método de pago, vista previa del historial. (${REPON_AUTH_PACKAGE_ID})`}
      />
      <AuthWiringProbe />
    </>
  );
}
