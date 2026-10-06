import React from 'react';
import { calculateTotal } from '../utils/orderTotal.mjs';

const Modal = ({ isOpen, submitting = false, bookingInfo, quantities, menuItems = [], onConfirm, onCancel }) => {
  if (!isOpen) return null;

  const total = calculateTotal(quantities, menuItems);

  return (
    <div className="modal-overlay open">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="order-modal-title">
        <h2 id="order-modal-title">Подтверждение заказа</h2>
        <div className="modal-section">
          <div className="modal-row">
            <span>Столик:</span>
            <span>№{bookingInfo?.tableId}</span>
          </div>
          <div className="modal-row">
            <span>Время:</span>
            <span>{bookingInfo?.timeSlot}</span>
          </div>
        </div>
        <div className="modal-section">
          {Object.entries(quantities).map(([id, qty]) => {
            const item = menuItems.find((m) => m.id === Number(id));
            if (!item) return null;
            return (
              <div key={id} className="modal-row">
                <span>{item.name} × {qty}</span>
                <span>{item.price * qty} ₽</span>
              </div>
            );
          })}
          <div className="modal-row total">
            <span>Итого:</span>
            <span>{total} ₽</span>
          </div>
        </div>
        <div className="modal-btns">
          <button className="btn btn-outline" onClick={onCancel} disabled={submitting}>Отмена</button>
          <button className="btn" onClick={onConfirm} disabled={submitting}>
            {submitting ? 'Оформляем…' : 'Подтвердить'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Modal;
