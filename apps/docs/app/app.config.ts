export default defineAppConfig({
    app: {
        domain: 'insight.liria.me',
    },
    docus: {
        locale: 'en',
    },
    github: {
        branch: 'main',
        name: 'insight-ts',
        owner: 'liria24',
        rootDir: 'apps/docs',
        url: 'https://github.com/liria24/insight-ts',
    },
    header: {
        title: 'Insight.ts',
    },
    seo: {
        description: 'Typed insights across analytics, observability, and application data.',
        title: 'Insight.ts',
        titleTemplate: '%s | Insight.ts',
    },
    ui: {
        colors: {
            primary: 'zinc',
            neutral: 'zinc',
        },
        icons: {
            loading: 'svg-spinners:ring-resize',
            arrowDown: 'mingcute:arrow-down-line',
            arrowLeft: 'mingcute:arrow-left-line',
            arrowRight: 'mingcute:arrow-right-line',
            arrowUp: 'mingcute:arrow-up-line',
            caution: 'mingcute:warning-fill',
            check: 'mingcute:check-fill',
            chevronDoubleLeft: 'mingcute:arrows-left-line',
            chevronDoubleRight: 'mingcute:arrows-right-line',
            chevronDown: 'mingcute:down-line',
            chevronLeft: 'mingcute:left-line',
            chevronRight: 'mingcute:right-line',
            chevronUp: 'mingcute:up-line',
            close: 'mingcute:close-line',
            copy: 'mingcute:copy-2-line',
            copyCheck: 'mingcute:copy-2-fill',
            dark: 'mingcute:moon-fill',
            drag: 'mingcute:dots-fill',
            ellipsis: 'mingcute:more-1-fill',
            error: 'mingcute:close-circle-fill',
            external: 'mingcute:arrow-right-up-line',
            eye: 'mingcute:eye-2-fill',
            eyeOff: 'mingcute:eye-close-fill',
            file: 'mingcute:file-fill',
            folder: 'mingcute:folder-fill',
            folderOpen: 'mingcute:folder-open-fill',
            hash: 'mingcute:hashtag-fill',
            info: 'mingcute:information-fill',
            light: 'mingcute:sun-fill',
            menu: 'mingcute:menu-fill',
            minus: 'mingcute:minimize-fill',
            panelClose: 'mingcute:layout-leftbar-close-fill',
            panelOpen: 'mingcute:layout-leftbar-open-fill',
            plus: 'mingcute:add-fill',
            reload: 'mingcute:refresh-2-fill',
            search: 'mingcute:search-line',
            stop: 'mingcute:square-fill',
            success: 'mingcute:check-circle-fill',
            system: 'mingcute:monitor-fill',
            tip: 'mingcute:bulb-2-fill',
            upload: 'mingcute:upload-fill',
            warning: 'mingcute:alert-fill',
        },
        accordion: {
            slots: {
                trigger: 'cursor-pointer',
                item: 'md:py-2',
            },
        },
        button: {
            slots: {
                base: 'cursor-pointer',
            },
            compoundVariants: [
                {
                    loading: true,
                    leading: true,
                    class: {
                        leadingIcon: 'animate-none',
                    },
                },
                {
                    loading: true,
                    leading: false,
                    trailing: true,
                    class: {
                        trailingIcon: 'animate-none',
                    },
                },
            ],
        },
        commandPalette: {
            slots: {
                item: 'cursor-pointer',
            },
            variants: {
                loading: {
                    true: {
                        itemLeadingIcon: 'animate-none',
                    },
                },
            },
        },
        contextMenu: {
            variants: {
                loading: {
                    true: {
                        itemLeadingIcon: 'animate-none',
                    },
                },
            },
        },
        dropdownMenu: {
            slots: {
                item: 'cursor-pointer',
            },
        },
        fileUpload: {
            slots: {
                base: 'cursor-pointer',
            },
        },
        input: {
            compoundVariants: [
                {
                    loading: true,
                    leading: true,
                    class: {
                        leadingIcon: 'animate-none',
                    },
                },
                {
                    loading: true,
                    leading: false,
                    trailing: true,
                    class: {
                        trailingIcon: 'animate-none',
                    },
                },
            ],
        },
        inputMenu: {
            compoundVariants: [
                {
                    loading: true,
                    leading: true,
                    class: {
                        leadingIcon: 'animate-none',
                    },
                },
                {
                    loading: true,
                    leading: false,
                    trailing: true,
                    class: {
                        trailingIcon: 'animate-none',
                    },
                },
            ],
        },
        inputTags: {
            compoundVariants: [
                {
                    loading: true,
                    leading: true,
                    class: {
                        leadingIcon: 'animate-none',
                    },
                },
                {
                    loading: true,
                    leading: false,
                    trailing: true,
                    class: {
                        trailingIcon: 'animate-none',
                    },
                },
            ],
        },
        navigationMenu: {
            slots: {
                link: 'cursor-pointer',
            },
            variants: {
                disabled: {
                    true: {
                        link: 'cursor-text',
                    },
                },
            },
        },
        select: {
            slots: {
                base: 'cursor-pointer',
            },
            compoundVariants: [
                {
                    loading: true,
                    leading: true,
                    class: {
                        leadingIcon: 'animate-none',
                    },
                },
                {
                    loading: true,
                    leading: false,
                    trailing: true,
                    class: {
                        trailingIcon: 'animate-none',
                    },
                },
            ],
        },
        selectMenu: {
            compoundVariants: [
                {
                    loading: true,
                    leading: true,
                    class: {
                        leadingIcon: 'animate-none',
                    },
                },
                {
                    loading: true,
                    leading: false,
                    trailing: true,
                    class: {
                        trailingIcon: 'animate-none',
                    },
                },
            ],
        },
        switch: {
            slots: {
                base: 'cursor-pointer',
                label: 'cursor-pointer',
            },
            variants: {
                loading: {
                    true: {
                        icon: 'animate-none',
                    },
                },
            },
        },
        tabs: {
            slots: {
                trigger: 'cursor-pointer',
            },
        },
        textarea: {
            compoundVariants: [
                {
                    loading: true,
                    leading: true,
                    class: {
                        leadingIcon: 'animate-none',
                    },
                },
                {
                    loading: true,
                    leading: false,
                    trailing: true,
                    class: {
                        trailingIcon: 'animate-none',
                    },
                },
            ],
        },
    },
})
