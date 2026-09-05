import React, { useState, useEffect } from 'react';
import { X, Navigation, AlertCircle, Loader2, MapPin, UserPlus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { geocodeAddress, reverseGeocode } from '../../services/geocodingService';

export default function AddPersonModal({
  isOpen,
  onClose,
  onAddPerson,
  editingPerson = null,
  isFirstPerson = false
}) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [mode, setMode] = useState('address'); // 'gps' or 'address'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (editingPerson) {
      setName(editingPerson.name);
      setAddress(editingPerson.address || '');
    } else if (isFirstPerson) {
      setName('You');
      setAddress('');
    } else {
      setName('');
      setAddress('');
    }
    setError(null);
  }, [editingPerson, isFirstPerson, isOpen]);

  if (!isOpen) return null;

  const handleUseGps = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!navigator.geolocation) {
        throw new Error('GPS location is not supported by your browser.');
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          const addressName = await reverseGeocode(lat, lng);

          onAddPerson({
            id: editingPerson ? editingPerson.id : `person-${Date.now()}`,
            name: name.trim() || (isFirstPerson ? 'You' : 'Friend'),
            lat,
            lng,
            address: addressName,
            isUser: isFirstPerson || (editingPerson && editingPerson.isUser)
          });
          setLoading(false);
          onClose();
        },
        (err) => {
          setLoading(false);
          if (err.code === err.PERMISSION_DENIED) {
            setError('Location permission is required to automatically use your current location. Enter an address manually below.');
          } else {
            setError('GPS signal unavailable. Please enter an address manually.');
          }
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } catch (err) {
      setLoading(false);
      setError(err.message);
    }
  };

  const handleAddressSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please enter a name for this person.');
      return;
    }
    if (!address.trim()) {
      setError('Please enter an address or city name.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const geoResult = await geocodeAddress(address.trim());
      onAddPerson({
        id: editingPerson ? editingPerson.id : `person-${Date.now()}`,
        name: name.trim(),
        lat: geoResult.lat,
        lng: geoResult.lng,
        address: geoResult.displayName,
        isUser: editingPerson ? editingPerson.isUser : isFirstPerson
      });
      setLoading(false);
      onClose();
    } catch (err) {
      setLoading(false);
      setError(err.message || 'Geocoding failed. Please verify address details.');
    }
  };

  return (
    <AnimatePresence>
      <div 
        className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
        style={{
          backgroundColor: 'rgba(6, 3, 15, 0.88)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)'
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 15 }}
          style={{
            width: '100%',
            maxWidth: '440px',
            margin: '0 auto',
            background: 'linear-gradient(145deg, #160a2c 0%, #251048 55%, #110624 100%)',
            border: '1px solid rgba(168, 85, 247, 0.4)',
            boxShadow: '0 25px 60px -10px rgba(0, 0, 0, 0.95), 0 0 40px rgba(147, 51, 234, 0.3)',
            borderRadius: '1.5rem',
            padding: '1.75rem',
            color: '#ffffff'
          }}
          className="relative shrink-0 font-['Outfit',sans-serif]"
        >
          {/* Header */}
          <div className="flex justify-between items-start mb-6 border-b border-purple-500/20 pb-4">
            <div className="flex items-center gap-3">
              <div 
                style={{
                  background: 'linear-gradient(135deg, #a855f7 0%, #7e22ce 100%)',
                  boxShadow: '0 0 15px rgba(168, 85, 247, 0.5)'
                }}
                className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shrink-0"
              >
                {editingPerson ? <MapPin className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />}
              </div>
              <div>
                <h2 className="text-base font-extrabold text-white tracking-tight uppercase">
                  {editingPerson ? 'Edit Location' : isFirstPerson ? 'Add Your Location' : 'Add Person'}
                </h2>
                <p className="text-xs text-purple-300/80 font-medium">
                  {isFirstPerson ? 'Set your base coordinate on the map' : 'Add member to group boundary'}
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              type="button"
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#e9d5ff'
              }}
              className="p-2 rounded-xl hover:bg-white/20 hover:text-white transition-all shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleAddressSubmit} className="space-y-4">
            {/* Person Name Input */}
            <div>
              <label className="block text-[11px] font-extrabold uppercase tracking-widest text-purple-300 mb-1.5">
                Name
              </label>
              <input
                type="text"
                placeholder={isFirstPerson ? 'You' : 'e.g. Rahul, Priya'}
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  borderRadius: '0.75rem',
                  background: 'rgba(10, 4, 22, 0.75)',
                  border: '1px solid rgba(168, 85, 247, 0.35)',
                  color: '#ffffff',
                  fontSize: '0.875rem',
                  outline: 'none'
                }}
                className="placeholder-purple-300/40 focus:border-purple-400 transition-all"
              />
            </div>

            {/* Location Option Selector Pills */}
            <div 
              style={{
                display: 'flex',
                gap: '0.5rem',
                padding: '0.25rem',
                background: 'rgba(0, 0, 0, 0.45)',
                borderRadius: '0.75rem',
                border: '1px solid rgba(168, 85, 247, 0.25)'
              }}
            >
              <button
                type="button"
                onClick={() => setMode('address')}
                style={{
                  flex: 1,
                  padding: '0.6rem 0.5rem',
                  fontWeight: 800,
                  fontSize: '0.75rem',
                  borderRadius: '0.5rem',
                  background: mode === 'address' ? 'linear-gradient(135deg, #a855f7 0%, #7e22ce 100%)' : 'transparent',
                  color: mode === 'address' ? '#ffffff' : '#c084fc',
                  border: 'none',
                  boxShadow: mode === 'address' ? '0 4px 15px rgba(168, 85, 247, 0.4)' : 'none',
                  cursor: 'pointer'
                }}
                className="transition-all uppercase tracking-wider"
              >
                Enter Address
              </button>

              <button
                type="button"
                onClick={() => setMode('gps')}
                style={{
                  flex: 1,
                  padding: '0.6rem 0.5rem',
                  fontWeight: 800,
                  fontSize: '0.75rem',
                  borderRadius: '0.5rem',
                  background: mode === 'gps' ? 'linear-gradient(135deg, #a855f7 0%, #7e22ce 100%)' : 'transparent',
                  color: mode === 'gps' ? '#ffffff' : '#c084fc',
                  border: 'none',
                  boxShadow: mode === 'gps' ? '0 4px 15px rgba(168, 85, 247, 0.4)' : 'none',
                  cursor: 'pointer'
                }}
                className="transition-all uppercase tracking-wider"
              >
                Use Device GPS
              </button>
            </div>

            {mode === 'gps' ? (
              <div className="space-y-3 pt-2">
                <p className="text-xs text-purple-200/80 leading-relaxed">
                  Fetches your device GPS coordinates. Please grant location permissions if prompted.
                </p>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={handleUseGps}
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '0.85rem',
                    background: 'linear-gradient(135deg, #a855f7 0%, #7e22ce 100%)',
                    color: '#ffffff',
                    fontWeight: 800,
                    fontSize: '0.875rem',
                    borderRadius: '0.75rem',
                    border: '1px solid rgba(233, 213, 255, 0.3)',
                    boxShadow: '0 10px 25px rgba(168, 85, 247, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    cursor: 'pointer'
                  }}
                  className="transition-all uppercase tracking-wider disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Navigation className="w-4 h-4" />}
                  <span>Use Device GPS</span>
                </motion.button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-extrabold uppercase tracking-widest text-purple-300 mb-1.5">
                    Address / Area / City
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Hyderabad, Gachibowli, Secunderabad..."
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.75rem 1rem',
                      borderRadius: '0.75rem',
                      background: 'rgba(10, 4, 22, 0.75)',
                      border: '1px solid rgba(168, 85, 247, 0.35)',
                      color: '#ffffff',
                      fontSize: '0.875rem',
                      outline: 'none'
                    }}
                    className="placeholder-purple-300/40 focus:border-purple-400 transition-all"
                  />
                </div>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '0.85rem',
                    background: 'linear-gradient(135deg, #a855f7 0%, #7e22ce 100%)',
                    color: '#ffffff',
                    fontWeight: 800,
                    fontSize: '0.875rem',
                    borderRadius: '0.75rem',
                    border: '1px solid rgba(233, 213, 255, 0.3)',
                    boxShadow: '0 10px 25px rgba(168, 85, 247, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    cursor: 'pointer'
                  }}
                  className="transition-all uppercase tracking-wider disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : null}
                  <span>{editingPerson ? 'Update Location' : 'Geocode & Save Location'}</span>
                </motion.button>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div 
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.75rem',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  color: '#fca5a5',
                  fontSize: '0.75rem',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.5rem'
                }}
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
                <span>{error}</span>
              </div>
            )}
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
