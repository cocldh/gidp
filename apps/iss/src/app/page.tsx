import { redirect } from 'next/navigation'

// Shell owns auth/project selection. Middleware redirects unauth'd users
// to the shell and bounces them back here after a project is picked.
export default function Home() {
  redirect('/dashboard')
}
