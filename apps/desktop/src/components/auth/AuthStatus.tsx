import { LogOut, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { UserInfo } from '@/hooks/useAuth';

interface AuthStatusProps {
  user: UserInfo | null;
  onLogout: () => Promise<void>;
}

export function AuthStatus({ user, onLogout }: AuthStatusProps) {
  if (!user) {
    return null;
  }

  const handleLogout = async () => {
    if (confirm('Are you sure you want to sign out?')) {
      try {
        await onLogout();
      } catch (err) {
        console.error('Logout failed:', err);
      }
    }
  };

  return (
    <div className="border border-black rounded-lg p-3 bg-white/5 backdrop-blur-md">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1">
          <User className="h-4 w-4 text-gray-600" />
          <div>
            <h3 className="text-sm font-medium text-gray-900">Account</h3>
            <p className="text-sm text-gray-700">{user.email}</p>
          </div>
        </div>
        <Button
          variant="destructive"
          onClick={handleLogout}
          className="ml-4 h-6 px-2 py-0 text-[10px]"
        >
          <LogOut className="h-3 w-3 mr-0.5" />
          Sign Out
        </Button>
      </div>
    </div>
  );
}
