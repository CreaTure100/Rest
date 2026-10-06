import React from 'react';
import { useNavigate } from 'react-router-dom';
import KitchenPanel from '../components/KitchenPanel';

const KitchenPage = ({ queue, onStartCooking, onComplete, onViewRecipe }) => {
  const navigate = useNavigate();
  return (
    <KitchenPanel
      queue={queue}
      onStartCooking={onStartCooking}
      onComplete={onComplete}
      onViewRecipe={onViewRecipe}
      onBack={() => navigate('/')}
    />
  );
};

export default KitchenPage;
