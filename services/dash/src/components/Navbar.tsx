import Link from 'next/link';
import {
  Box,
  Flex,
  Button,
  IconButton,
  Img,
  useDisclosure,
  useColorModeValue,
  useColorMode
} from '@chakra-ui/react';
import { FiMenu, FiX } from 'react-icons/fi';
import { MoonIcon, SunIcon } from '@chakra-ui/icons';
import { useUserStore } from '~/store/index';

const Navbar = () => {
  const user = useUserStore();
  const { isOpen, onToggle } = useDisclosure();

  const icon = useColorModeValue(<MoonIcon />, <SunIcon />);
  const { toggleColorMode } = useColorMode();

  const avatar = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}`
    : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator!, 10) % 5}.png`;

  const LoginButton = () =>
    user.loggedIn
      ? (
        <>
          <Link href = "/dashboard">
            <Button variant = "solid"
              justifyContent = {{ base: 'start', md: 'unset' }}
              mr = {{ base: 0, md: 2 }}
              mb = {{ base: 2, md: 0 }}
            >
              Dashboard
            </Button>
          </Link>
          {/* TODO(DD): Logout thingy? */}
          <Link href = "/dashboard">
            <Button variant = "ghost" justifyContent = {{ base: 'start', md: 'unset' }}>
              <Img mr = {2} rounded = "full"
                boxSize = "25px" src = {avatar}
                alt = {user.username!} />
              <Box>
                {user.username}
              </Box>
            </Button>
          </Link>
        </>
      )
      : (
        <Link href = {`${process.env.NEXT_PUBLIC_AUTH_DOMAIN}/api/v1/auth/discord?redirect_uri=${process.env.NEXT_PUBLIC_DASH_DOMAIN}/dashboard`}>
          <Button variant = "ghost" justifyContent = {{ base: 'start', md: 'unset' }}>
            Log In
          </Button>
        </Link>
      );

  return (
    <Flex as = "nav" p = {4}
      align = "center" justify = "space-between"
      wrap = "wrap">
      <Flex align = "center" mr = {5}>
        <Link href = "/">
          <Button variant = "ghost">
            AutoModerator
          </Button>
        </Link>
      </Flex>

      <Flex align = "center">
        <IconButton d = {{ base: 'flex', md: 'none' }}
          aria-label = "Open menu"
          variant = "ghost"
          icon = {isOpen ? <FiX /> : <FiMenu />}
          onClick = {onToggle}
        />
      </Flex>

      <Box d = {{ base: isOpen ? 'flex' : 'none', md: 'block' }}
        flexDirection = {{ base: 'column', md: 'unset' }}
        width = {{ base: 'full', md: 'auto' }}
        mt = {{ base: 2, md: 0 }}
      >
        <LoginButton />
        <IconButton onClick = {toggleColorMode}
          variant = "ghost"
          icon = {icon}
          aria-label = "Toggle Theme" />
      </Box>
    </Flex>
  );
};

export default Navbar;
