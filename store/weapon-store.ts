import { create } from 'zustand';

export type WeaponId = 'plasma' | 'laser' | 'grenade' | 'shield';

interface WeaponState {
  activeWeapon: WeaponId;
  setWeapon: (w: WeaponId) => void;
}

export const useWeaponStore = create<WeaponState>((set) => ({
  activeWeapon: 'plasma',
  setWeapon: (w) => set({ activeWeapon: w }),
}));
