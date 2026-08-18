import { useSession } from '@repon/auth';
import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';

/**
 * mobile-auth-login spec (core-api-sesion), "A pending company is allowed
 * to log in": `companyStatus: 'pendiente'` is a SUCCESS response, not a
 * refusal — a provider must be able to sign in to check its own approval
 * state. `(tabs)/_layout.tsx`'s `PendingApprovalGate` routes here instead
 * of the ordinary tab flow whenever `sesion.companyStatus === 'pendiente'`.
 */
export default function PendingApprovalScreen() {
  const { signOut } = useSession();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Tu empresa está en revisión</Text>
      <Text style={styles.description}>
        Recibimos tu solicitud de registro como proveedor. Un administrador está revisando tu
        empresa — te avisaremos apenas quede aprobada. Vuelve a intentarlo más tarde.
      </Text>
      <Text testID="pending-approval-signout" style={styles.signOut} onPress={() => void signOut()}>
        Cerrar sesión
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.7,
    maxWidth: 320,
  },
  signOut: {
    marginTop: 24,
    color: '#2e78b7',
    fontWeight: '600',
  },
});
