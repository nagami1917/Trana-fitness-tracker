<script>
  import Login from '../Login/Login.svelte';
  import { navigate } from '../../lib/router.js';
</script>

<Login {navigate} initialMode="signup" />
