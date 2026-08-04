import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../../styling/theme';
import { useWeaponStore, WeaponId } from '../../store/weapon-store';

interface Weapon {
  id:    WeaponId;
  label: string;
  icon:  React.ComponentProps<typeof MaterialCommunityIcons>['name'];
}

const WEAPONS: Weapon[] = [
  { id: 'plasma',  label: 'Plasma',  icon: 'lightning-bolt'   },
  { id: 'laser',   label: 'Laser',   icon: 'laser-pointer'    },
  { id: 'grenade', label: 'Grenade', icon: 'bomb'             },
  { id: 'shield',  label: 'Shield',  icon: 'shield-half-full' },
];

export function WeaponBar() {
  const { activeWeapon, setWeapon } = useWeaponStore();

  return (
    <View style={styles.bar} pointerEvents="box-none">
      {WEAPONS.map((w) => {
        const active = w.id === activeWeapon;
        return (
          <Pressable
            key={w.id}
            style={[styles.tab, active && styles.tabActive]}
            onPress={() => setWeapon(w.id)}
          >
            <MaterialCommunityIcons
              name={w.icon}
              size={26}
              color={active ? Colors.orange : Colors.alabaster}
            />
            <Text style={[styles.label, active && styles.labelActive]}>
              {w.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position:        'absolute',
    bottom:          20,
    left:            0,
    right:           0,
    flexDirection:   'row',
    justifyContent:  'center',
    alignItems:      'center',
    gap:             8,
    pointerEvents:   'box-none',
  },
  tab: {
    alignItems:       'center',
    justifyContent:   'center',
    width:            68,
    height:           68,
    borderRadius:     12,
    backgroundColor:  'rgba(20, 33, 61, 0.70)',
    borderWidth:      1.5,
    borderColor:      'rgba(229, 229, 229, 0.20)',
    gap:              4,
  },
  tabActive: {
    borderColor:     Colors.orange,
    backgroundColor: 'rgba(252, 163, 17, 0.15)',
  },
  label: {
    color:     Colors.alabaster,
    fontSize:  10,
    fontWeight: '500',
  },
  labelActive: {
    color: Colors.orange,
  },
});
