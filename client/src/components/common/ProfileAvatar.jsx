import { useEffect, useState } from 'react'
import { GraduationCap, ShieldCheck, UserRound } from 'lucide-react'

const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'
const roleIcons = { admin: ShieldCheck, teacher: UserRound, student: GraduationCap }

export default function ProfileAvatar({ user, size = 'normal', className = '' }) {
  const [failed, setFailed] = useState(false)
  const userId = user?.id || user?._id
  const photo = user?.profileImage

  useEffect(() => setFailed(false), [userId, photo])

  if (userId && photo && !failed) {
    return <span className={`profile-avatar avatar-${size} ${className}`}>
      <img src={`/api/profile/${userId}/photo?v=${encodeURIComponent(photo)}`} alt={`${user.fullName || 'User'} profile`} onError={() => setFailed(true)} />
    </span>
  }

  const RoleIcon = roleIcons[user?.role] || UserRound
  return <span className={`profile-avatar avatar-${size} avatar-role-${user?.role || 'default'} ${className}`} aria-label={`${user?.role || 'user'} account profile`}>
    {user?.fullName ? <span>{initials(user.fullName)}</span> : <RoleIcon size={size === 'large' ? 34 : 17} />}
  </span>
}
