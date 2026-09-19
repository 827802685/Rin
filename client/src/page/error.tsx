import { useTranslation } from 'react-i18next'
import { Button } from '../components/button'
import { SiteMeta } from '../components/site-meta'

export function ErrorPage({error}: {error?: string}) {
    const { t } = useTranslation()
    return (
        <SiteMeta title={t('error.title')}>
            <div className="w-full flex flex-row justify-center ani-show">
                    <div className="flex flex-col wauto rounded-2xl bg-w m-2 p-6 items-center justify-center space-y-2">
                    <h1 className="text-xl font-bold t-primary">{error}</h1>
                    <Button
                        title={t("index.back")}
                        onClick={() => (window.location.href = "/")}
                    />
                </div>
            </div>
        </SiteMeta>
    );
}
