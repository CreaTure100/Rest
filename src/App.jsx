import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import './styles/App.css';
import Navigation from './components/Navigation';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import TablesPage from './pages/TablesPage';
import OrderPage from './pages/OrderPage';
import MenuPage from './pages/MenuPage';
import KitchenPage from './pages/KitchenPage';
import Modal from './components/Modal';
import AdminPanel from './components/AdminPanel';
import apiClient from './api/client';
import MenuRedactor from './pages/MenuRedactor';
import UserRedactor from './pages/UserRedactor';
import { validateBookingSlot, parseTimeSlot, slotsOverlap, formatSlot } from './utils/timeSlot.mjs';

const STAFF_ROLES = ['admin', 'waiter', 'chef'];
const POLL_INTERVAL_MS = 10000;

// Вынесен из App: раньше объявлялся внутри компонента и пересоздавался при каждом рендере,
// из-за чего вся страница внутри (меню, форма брони) размонтировалась и теряла состояние.
function ProtectedRoute({ user, allowedRoles = [], children }) {
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function readSavedUser() {
  try {
    const raw = localStorage.getItem('currentUser');
    return raw && localStorage.getItem('accessToken') ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function App() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedTable, setSelectedTable] = useState(null);
  const [bookingInfo, setBookingInfo] = useState(null);
  const [quantities, setQuantities] = useState({}); // { [id блюда]: количество }
  const [dishComments, setDishComments] = useState({}); // { [id блюда]: комментарий }
  const [orders, setOrders] = useState([]);
  const [tables, setTables] = useState([]);
  const [dishQueue, setDishQueue] = useState([]);
  const [users, setUsers] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadMenu = useCallback(async () => {
    try {
      setMenuItems(await apiClient.getMenu());
    } catch (error) {
      console.error('Error loading menu:', error);
    }
  }, []);

  // Единая загрузка данных по роли (раньше дублировалась в двух местах).
  // Повар и админ получают меню с рецептами, поэтому меню перезагружается после входа.
  const loadRoleData = useCallback(
    async (user) => {
      const jobs = [apiClient.getTables().then(setTables), apiClient.getOrders().then(setOrders)];
      if (user.role === 'chef' || user.role === 'admin') {
        jobs.push(apiClient.getKitchenQueue().then(setDishQueue), loadMenu());
      }
      if (user.role === 'admin') jobs.push(apiClient.getUsers().then(setUsers));
      await Promise.allSettled(jobs);
    },
    [loadMenu]
  );

  const refreshOrdersAndQueue = useCallback(async () => {
    const jobs = [apiClient.getOrders().then(setOrders)];
    if (currentUser?.role === 'chef' || currentUser?.role === 'admin') {
      jobs.push(apiClient.getKitchenQueue().then(setDishQueue));
    }
    await Promise.allSettled(jobs);
  }, [currentUser]);

  useEffect(() => {
    (async () => {
      try {
        const saved = readSavedUser();
        if (!saved) {
          await loadMenu();
          return;
        }
        // Проверяем сессию на сервере: заодно обновится просроченный токен и актуальная роль
        const fresh = await apiClient.getMe().catch(() => null);
        if (!fresh) {
          await loadMenu();
          return;
        }
        localStorage.setItem('currentUser', JSON.stringify(fresh));
        setCurrentUser(fresh);
        await Promise.all([loadMenu(), loadRoleData(fresh)]);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadMenu, loadRoleData]);

  // Сотрудники видят новые заказы без перезагрузки страницы
  useEffect(() => {
    if (!currentUser || !STAFF_ROLES.includes(currentUser.role)) return undefined;
    const tick = () => {
      if (document.hidden) return;
      const jobs = [apiClient.getOrders().then(setOrders), apiClient.getTables().then(setTables)];
      if (currentUser.role === 'chef' || currentUser.role === 'admin') {
        jobs.push(apiClient.getKitchenQueue().then(setDishQueue));
      }
      Promise.allSettled(jobs);
    };
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [currentUser]);

  const handleLogin = async (user) => {
    setCurrentUser(user);
    localStorage.setItem('currentUser', JSON.stringify(user));
    await loadRoleData(user);
  };

  const handleLogout = async () => {
    try {
      await apiClient.logout();
    } finally {
      setCurrentUser(null);
      localStorage.removeItem('currentUser');
      setSelectedTable(null);
      setBookingInfo(null);
      setQuantities({});
      setDishComments({});
      setOrders([]);
      setDishQueue([]);
      setUsers([]);
      setTables([]);
      loadMenu(); // публичное меню без рецептов
    }
  };

  const handleTableClick = (tableId) => {
    const table = tables.find((t) => t.id === tableId);
    if (table && table.status !== 'booked') setSelectedTable(table);
  };

  // Ранняя проверка на клиенте; окончательно время проверяет сервер при оформлении заказа
  const handleBook = (timeSlot) => {
    const result = validateBookingSlot(timeSlot);
    if (!result.ok) {
      alert(result.error);
      return false;
    }
    const table = tables.find((t) => t.id === selectedTable.id);
    const taken = (table?.slots || []).map(parseTimeSlot).filter(Boolean);
    if (taken.some((slot) => slotsOverlap(result.slot, slot))) {
      alert('Это время уже забронировано!');
      return false;
    }
    setBookingInfo({ tableId: selectedTable.id, timeSlot: formatSlot(result.slot) });
    return true;
  };

  const handleQuantityChange = (dishId, delta) => {
    setQuantities((prev) => {
      const next = (prev[dishId] || 0) + delta;
      if (next <= 0) {
        const { [dishId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [dishId]: next };
    });
  };

  const handleDishCommentChange = (dishId, comment) => {
    setDishComments((prev) => ({ ...prev, [dishId]: comment }));
  };

  const handlePay = () => {
    if (Object.keys(quantities).length > 0) setShowModal(true);
  };

  const handleConfirmOrder = async () => {
    if (submitting) return; // защита от двойного клика: иначе второй запрос получал бы ошибку "время занято"
    setSubmitting(true);
    try {
      const dishes = Object.entries(quantities).map(([dishId, quantity]) => ({
        dishId: Number(dishId),
        quantity,
        comment: dishComments[dishId] || '',
      }));
      // Бронь и заказ создаются одним запросом (атомарно), "осиротевших" броней не остаётся
      await apiClient.createOrder(bookingInfo.tableId, bookingInfo.timeSlot, dishes, currentUser?.name);
      await loadRoleData(currentUser);

      setQuantities({});
      setDishComments({});
      setShowModal(false);
      setBookingInfo(null);
      setSelectedTable(null);
      alert('Стол забронирован и заказ подтверждён! Спасибо.');
    } catch (error) {
      console.error('Error:', error);
      if (error.status === 409) apiClient.getTables().then(setTables).catch(() => {});
      alert(error.message || 'Ошибка при оформлении заказа');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelOrder = () => setShowModal(false);

  const handleBackToTables = () => {
    setBookingInfo(null);
    setQuantities({});
    setDishComments({});
  };

  const handleServed = async (orderId, dishIdx) => {
    try {
      await apiClient.serveDish(orderId, dishIdx);
      await refreshOrdersAndQueue();
    } catch (error) {
      console.error('Error serving dish:', error);
      alert(error.message || 'Не удалось отметить подачу');
      refreshOrdersAndQueue();
    }
  };

  const handleStartCooking = async (queueId) => {
    try {
      await apiClient.startCooking(queueId);
    } catch (error) {
      console.error('Error starting cooking:', error);
      alert(error.message || 'Ошибка при начале готовки');
    }
    await refreshOrdersAndQueue();
  };

  const handleCompleteDish = async (queueId) => {
    try {
      await apiClient.completeDish(queueId);
    } catch (error) {
      console.error('Error completing dish:', error);
      alert(error.message || 'Ошибка при отметке блюда');
    }
    await refreshOrdersAndQueue();
  };

  const handleViewRecipe = async (dishId) => {
    try {
      return await apiClient.getRecipe(dishId);
    } catch (error) {
      console.error('Error loading recipe:', error);
      alert(error.message || 'Ошибка при загрузке рецепта');
      return null;
    }
  };

  const withReload = (action, reload, successText, errorText) => async (...args) => {
    try {
      await action(...args);
      await reload();
      alert(successText);
    } catch (error) {
      console.error(errorText, error);
      alert(error.message || errorText);
    }
  };

  const reloadUsers = async () => setUsers(await apiClient.getUsers());

  const handleUpdateMenu = withReload((id, data) => apiClient.updateDish(id, data), loadMenu, 'Меню обновлено', 'Ошибка при обновлении меню');
  const handleCreateDish = withReload((data) => apiClient.createDish(data), loadMenu, 'Блюдо добавлено', 'Ошибка при добавлении блюда');
  const deleteDish = withReload((id) => apiClient.deleteDish(id), loadMenu, 'Блюдо удалено', 'Ошибка при удалении блюда');
  const handleDeleteDish = (dishId) => (window.confirm('Удалить блюдо?') ? deleteDish(dishId) : undefined);

  const handleUpdateUser = withReload((id, data) => apiClient.updateUser(id, data), reloadUsers, 'Пользователь обновлён', 'Ошибка при обновлении пользователя');
  const blockUser = withReload((id) => apiClient.blockUser(id), reloadUsers, 'Пользователь заблокирован', 'Ошибка при блокировке пользователя');
  const handleBlockUser = (userId) => (window.confirm('Заблокировать пользователя?') ? blockUser(userId) : undefined);
  const handleCreateEmployee = withReload(
    (name, email, password, role) => apiClient.createEmployee(name, email, password, role),
    reloadUsers,
    'Сотрудник добавлен',
    'Ошибка при добавлении сотрудника'
  );

  if (loading) return <div className="loading">Загрузка...</div>;

  const goHome = () => navigate('/');

  return (
    <>
      <Navigation isAuthenticated={!!currentUser} user={currentUser} onLogout={handleLogout} />

      <Routes>
        <Route path="/" element={<HomePage isAuthenticated={!!currentUser} />} />
        <Route path="/menu" element={<MenuPage menuItems={menuItems} />} />
        <Route path="/login" element={currentUser ? <Navigate to="/" /> : <LoginPage onLogin={handleLogin} />} />
        <Route
          path="/booking"
          element={
            <ProtectedRoute user={currentUser}>
              {bookingInfo ? (
                <OrderPage
                  bookingInfo={bookingInfo}
                  quantities={quantities}
                  menuItems={menuItems}
                  dishComments={dishComments}
                  onQuantityChange={handleQuantityChange}
                  onDishCommentChange={handleDishCommentChange}
                  onPay={handlePay}
                  onBack={handleBackToTables}
                />
              ) : (
                <TablesPage tables={tables} selectedTable={selectedTable} onTableClick={handleTableClick} onBook={handleBook} />
              )}
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute user={currentUser} allowedRoles={['admin', 'waiter']}>
              <AdminPanel orders={orders} onServed={handleServed} onBack={goHome} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/kitchen"
          element={
            <ProtectedRoute user={currentUser} allowedRoles={['chef', 'admin']}>
              <KitchenPage queue={dishQueue} onStartCooking={handleStartCooking} onComplete={handleCompleteDish} onViewRecipe={handleViewRecipe} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/menu"
          element={
            <ProtectedRoute user={currentUser} allowedRoles={['admin']}>
              <MenuRedactor menuItems={menuItems} onUpdateMenu={handleUpdateMenu} onCreateDish={handleCreateDish} onDeleteDish={handleDeleteDish} onBack={goHome} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute user={currentUser} allowedRoles={['admin']}>
              <UserRedactor users={users} onUpdateUser={handleUpdateUser} onBlockUser={handleBlockUser} onCreateEmployee={handleCreateEmployee} onBack={goHome} />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <Modal
        isOpen={showModal}
        submitting={submitting}
        bookingInfo={bookingInfo}
        quantities={quantities}
        menuItems={menuItems}
        onConfirm={handleConfirmOrder}
        onCancel={handleCancelOrder}
      />
    </>
  );
}

export default App;
