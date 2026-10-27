import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/Login';
import { ChangePasswordPage } from './pages/ChangePassword';

import { EmployeeHome } from './pages/employee/EmployeeHome';
import { MyTrainings, TrainingDetail } from './pages/employee/MyTrainings';
import { ModuleView } from './pages/employee/ModuleView';
import { TestRunner } from './pages/employee/TestRunner';

import { People } from './pages/admin/People';
import { ManagerHome } from './pages/manager/ManagerHome';
import { ManagerTrainings } from './pages/manager/Trainings';
import { TrainingConstructor, ModuleEditor } from './pages/manager/Constructor';
import { Employees } from './pages/manager/Employees';
import { Assignments } from './pages/manager/Assignments';

import { AdminHome, AiSettings, Integrations, UiSettings, Permissions, PlatformSettings } from './pages/admin/Admin';
import { Certificates, MyResults, Results, Lectures, AuditLog, Profile, CustomPage } from './pages/Common';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
});

/* Маршрутизация по кабинетам.

   Кабинет определяет сервер по ролям пользователя, поэтому подобрать
   «чужой» адрес нельзя: даже открыв /admin, пользователь без прав получит
   отказ от API — интерфейс лишь не показывает недоступное. */

function Router() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
  if (!user) return <LoginPage />;
  if (user.mustChangePassword) return <ChangePasswordPage />;

  const home = `/${user.cabinet}`;
  if (location.pathname.startsWith('/admin') && user.cabinet !== 'admin' ||
      location.pathname.startsWith('/manager') && user.cabinet !== 'manager' ||
      location.pathname.startsWith('/employee') && user.cabinet !== 'employee') return <Navigate to={home} replace />;

  return (
    <Routes>
      <Route path="/" element={<Navigate to={home} replace />} />

      <Route path="/employee" element={<Layout />}>
        <Route index element={<EmployeeHome />} />
        <Route path="trainings" element={<MyTrainings />} />
        <Route path="trainings/:id" element={<TrainingDetail />} />
        <Route path="modules/:id" element={<ModuleView />} />
        <Route path="test/:attemptId" element={<TestRunner />} />
        <Route path="tests" element={<MyResults />} />
        <Route path="lectures" element={<Lectures scope="my" />} />
        <Route path="certificates" element={<Certificates scope="my" />} />
        <Route path="permits" element={<Certificates scope="my" />} />
        <Route path="library" element={<MyResults />} />
        <Route path="profile" element={<Profile />} />
        <Route path="pages/:slug" element={<CustomPage />} />
      </Route>

      <Route path="/manager" element={<Layout />}>
        <Route index element={<ManagerHome />} />
        <Route path="trainings" element={<ManagerTrainings />} />
        <Route path="trainings/:id" element={<TrainingConstructor />} />
        <Route path="modules/:id" element={<ModuleEditor />} />
        <Route path="constructor" element={<ManagerTrainings />} />
        <Route path="tests" element={<Results />} />
        <Route path="employees" element={<Employees />} />
        <Route path="assignments" element={<Assignments />} />
        <Route path="results" element={<Results />} />
        <Route path="lectures" element={<Lectures scope="manage" />} />
        <Route path="certificates" element={<Certificates scope="manage" />} />
        <Route path="permits" element={<Certificates scope="manage" />} />
        <Route path="ai" element={<Navigate to="/manager" replace />} />
        <Route path="audit" element={<AuditLog />} />
        <Route path="profile" element={<Profile />} />
        <Route path="pages/:slug" element={<CustomPage />} />
      </Route>

      <Route path="/admin" element={<Layout />}>
        <Route index element={<AdminHome />} />
        <Route path="users" element={<People />} />
        <Route path="managers" element={<Navigate to="/admin/users" replace />} />
        <Route path="employees" element={<Navigate to="/admin/users" replace />} />
        <Route path="trainings" element={<Navigate to="/admin" replace />} />
        <Route path="trainings/:id" element={<Navigate to="/admin" replace />} />
        <Route path="modules/:id" element={<Navigate to="/admin" replace />} />
        <Route path="assignments" element={<Navigate to="/admin" replace />} />
        <Route path="lectures" element={<Navigate to="/admin" replace />} />
        <Route path="certificates" element={<Navigate to="/admin" replace />} />
        <Route path="permits" element={<Navigate to="/admin" replace />} />
        <Route path="ai" element={<AiSettings />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="ui" element={<UiSettings />} />
        <Route path="pages" element={<Navigate to="/admin" replace />} />
        <Route path="permissions" element={<Navigate to="/admin" replace />} />
        <Route path="settings" element={<Navigate to="/admin" replace />} />
        <Route path="audit" element={<Navigate to="/admin" replace />} />
        <Route path="organization" element={<Navigate to="/admin" replace />} />
        <Route path="departments" element={<Navigate to="/admin/users" replace />} />
        <Route path="positions" element={<Navigate to="/admin/users" replace />} />
        <Route path="professions" element={<Navigate to="/admin/users" replace />} />
        <Route path="files" element={<Navigate to="/admin" replace />} />
      </Route>

      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter><Router /></BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
