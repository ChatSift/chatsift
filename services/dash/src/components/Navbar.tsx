import Link from 'next/link';
import {
  Box,
  Flex,
  ButtonGroup,
  Button,
  IconButton,
  Img,
  Text,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverCloseButton,
  PopoverBody,
  useDisclosure,
  useColorModeValue,
  useColorMode
} from '@chakra-ui/react';
import { FiMenu, FiX } from 'react-icons/fi';
import { MoonIcon, SunIcon } from '@chakra-ui/icons';
import { useUserStore } from '~/store/index';
import { useState } from 'react';

const Navbar = () => {
  const user = useUserStore();
  const { isOpen, onToggle } = useDisclosure();

  const icon = useColorModeValue(<MoonIcon />, <SunIcon />);
  const { toggleColorMode } = useColorMode();

  const [popoverIsOpen, setPopoverIsOpen] = useState<boolean>(false);

  const avatar = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}`
    : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator!, 10) % 5}.png`;

  const LoginButton = () =>
    user.loggedIn
      ? (
        <>
          <Link href = "/guilds">
            <Button variant = "solid"
              justifyContent = {{ base: 'start', md: 'unset' }}
              mr = {{ base: 0, md: 2 }}
              mb = {{ base: 2, md: 0 }}
            >
              Server selection
            </Button>
          </Link>

          <Popover placement = "bottom-end"
            isOpen = {popoverIsOpen}
            onClose = {() => setPopoverIsOpen(false)}>
            <PopoverTrigger>
              <Button variant = "ghost"
                justifyContent = {{ base: 'start', md: 'unset' }}
                onClick = {() => setPopoverIsOpen(true)}>
                <Img mr = {2} rounded = "full"
                  boxSize = "25px" src = {avatar}
                  alt = {user.username!} />
                <Box>
                  {user.username}
                </Box>
              </Button>
            </PopoverTrigger>

            <PopoverContent border = "0">
              <PopoverCloseButton />
              <PopoverBody>
                <Text fontWeight = "semibold">
                  Confirmation
                </Text>

                <Text pt = {0.5}>
                  Are you sure you want to log out?
                </Text>

                <ButtonGroup d = "flex"
                  justifyContent = "flex-end"
                  pt = {2}
                  size = "sm">
                  <Link href = {`${process.env.NEXT_PUBLIC_AUTH_DOMAIN}/api/v1/auth/discord/logout?redirect_uri=${process.env.NEXT_PUBLIC_DASH_DOMAIN}`}>
                    <Button colorScheme = "red">
                      Confirm
                    </Button>
                  </Link>

                  <Button variant = "outline" onClick = {() => setPopoverIsOpen(false)}>
                    Cancel
                  </Button>
                </ButtonGroup>
              </PopoverBody>
            </PopoverContent>
          </Popover>
        </>
      )
      : (
        <Link href = {`${process.env.NEXT_PUBLIC_AUTH_DOMAIN}/api/v1/auth/discord?redirect_uri=${process.env.NEXT_PUBLIC_DASH_DOMAIN}/guilds`}>
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
